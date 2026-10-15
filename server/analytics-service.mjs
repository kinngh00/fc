import { randomUUID } from "node:crypto";
import { db } from "./database.mjs";

const RETENTION_DAYS = 30;
const ONLINE_MINUTES = 5;
const NEW_VISIT_MINUTES = 30;
let lastCleanupAt = 0;

function text(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function safeDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const blocked = /password|passwd|cookie|authorization|token|secret|content|comment/i;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key)).slice(0, 40).map(([key, item]) => {
    if (typeof item === "string") return [text(key, 80), text(item, 500)];
    if (typeof item === "number" || typeof item === "boolean" || item == null) return [text(key, 80), item];
    return [text(key, 80), text(JSON.stringify(item), 1000)];
  }));
}

function cleanup() {
  if (Date.now() - lastCleanupAt < 60 * 60 * 1000) return;
  db.prepare("DELETE FROM visitor_events WHERE datetime(occurred_at) < datetime('now', ?)").run(`-${RETENTION_DAYS} days`);
  db.prepare("DELETE FROM visitor_sessions WHERE datetime(last_seen_at) < datetime('now', ?)").run(`-${RETENTION_DAYS} days`);
  lastCleanupAt = Date.now();
}

function updateLifetime(identityType, identityValue, { userId = null, ip, now }) {
  const existing = db.prepare("SELECT last_visit_at FROM visitor_lifetime_stats WHERE identity_type=? AND identity_value=?").get(identityType, identityValue);
  if (!existing) {
    db.prepare(`INSERT INTO visitor_lifetime_stats
      (identity_type, identity_value, user_id, last_ip_address, first_seen_at, last_seen_at, last_visit_at, visit_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(identityType, identityValue, userId, ip, now, now, now);
    return;
  }
  const isNewVisit = Date.now() - new Date(existing.last_visit_at).getTime() >= NEW_VISIT_MINUTES * 60_000;
  db.prepare(`UPDATE visitor_lifetime_stats SET user_id=COALESCE(?,user_id), last_ip_address=?, last_seen_at=?,
    last_visit_at=CASE WHEN ? THEN ? ELSE last_visit_at END, visit_count=visit_count+? WHERE identity_type=? AND identity_value=?`)
    .run(userId, ip, now, isNewVisit ? 1 : 0, now, isNewVisit ? 1 : 0, identityType, identityValue);
}

export function requestIp(request) {
  const forwarded = text(request.headers["x-forwarded-for"], 500).split(",")[0].trim();
  const real = text(request.headers["x-real-ip"], 100);
  const remote = text(request.socket?.remoteAddress, 100).replace(/^::ffff:/, "");
  return forwarded || real || remote || "unknown";
}

function parseAgent(userAgent) {
  const ua = text(userAgent, 1000);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "기타";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "기타";
  const deviceType = /Mobile|Android|iPhone/i.test(ua) ? "mobile" : /iPad|Tablet/i.test(ua) ? "tablet" : "desktop";
  return { browser, os, deviceType };
}

function ensureSession({ visitorId, request, user, client = {} }) {
  cleanup();
  const id = /^[a-zA-Z0-9_-]{12,80}$/.test(visitorId || "") ? visitorId : randomUUID();
  const now = new Date().toISOString();
  const ip = requestIp(request);
  const userAgent = text(client.userAgent || request.headers["user-agent"], 1000);
  const parsed = parseAgent(userAgent);
  db.prepare(`
    INSERT INTO visitor_sessions (
      visitor_id, first_seen_at, last_seen_at, ip_address, user_id, current_path, referrer,
      user_agent, browser, os, device_type, language, timezone, screen_width, screen_height,
      viewport_width, viewport_height
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(visitor_id) DO UPDATE SET
      last_seen_at=excluded.last_seen_at, ip_address=excluded.ip_address, user_id=excluded.user_id,
      current_path=COALESCE(NULLIF(excluded.current_path,''), visitor_sessions.current_path), referrer=COALESCE(NULLIF(excluded.referrer,''), visitor_sessions.referrer),
      user_agent=excluded.user_agent, browser=excluded.browser, os=excluded.os, device_type=excluded.device_type,
      language=excluded.language, timezone=excluded.timezone, screen_width=excluded.screen_width,
      screen_height=excluded.screen_height, viewport_width=excluded.viewport_width, viewport_height=excluded.viewport_height
  `).run(id, now, now, ip, user?.id || null, text(client.path, 1000), text(client.referrer, 1000), userAgent,
    text(client.browser, 80) || parsed.browser, text(client.os, 80) || parsed.os,
    text(client.deviceType, 40) || parsed.deviceType, text(client.language, 80), text(client.timezone, 100),
    integer(client.screenWidth, 0, 20000), integer(client.screenHeight, 0, 20000),
    integer(client.viewportWidth, 0, 20000), integer(client.viewportHeight, 0, 20000));
  updateLifetime("ip", ip, { ip, now });
  if (user?.id) updateLifetime("user", String(user.id), { userId: user.id, ip, now });
  return { id, ip, now };
}

export function recordClientEvent({ request, user, input }) {
  const type = text(input?.type, 60);
  if (!/^(page_view|heartbeat|visibility|page_exit|click|search|community_view)$/.test(type)) {
    throw new Error("INVALID_ANALYTICS_EVENT");
  }
  const session = ensureSession({ visitorId: text(input?.visitorId, 80), request, user, client: input?.client || {} });
  const path = text(input?.path || input?.client?.path, 1000);
  if (/googleads|adsbygoogle|doubleclick|pagead/i.test(`${path} ${input?.target || ""}`)) return { visitorId: session.id, ignored: true };
  const details = safeDetails(input?.details);
  db.prepare(`INSERT INTO visitor_events
    (visitor_id, user_id, ip_address, event_type, path, page_title, target, search_type, details_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(session.id, user?.id || null, session.ip, type, path, text(input?.pageTitle, 300), text(input?.target, 500), text(input?.searchType, 80), JSON.stringify(details), session.now);
  db.prepare(`UPDATE visitor_sessions SET last_seen_at=?, current_path=?, user_id=?, event_count=event_count+1,
    page_view_count=page_view_count+? WHERE visitor_id=?`)
    .run(session.now, path, user?.id || null, type === "page_view" ? 1 : 0, session.id);
  return { visitorId: session.id };
}

export function recordApiRequest({ request, user, url, status = 200 }) {
  if (!url.pathname.startsWith("/api/") || /^\/api\/(analytics|admin|health)/.test(url.pathname)) return;
  const visitorId = text(request.headers["x-fc-visitor-id"], 80);
  if (!visitorId) return;
  const session = ensureSession({ visitorId, request, user, client: {} });
  const query = Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !/password|token|secret/i.test(key)).slice(0, 30));
  db.prepare(`INSERT INTO visitor_events
    (visitor_id, user_id, ip_address, event_type, path, target, details_json, occurred_at)
    VALUES (?, ?, ?, 'api_request', ?, ?, ?, ?)`)
    .run(session.id, user?.id || null, session.ip, url.pathname, request.method, JSON.stringify({ query, status }), session.now);
  db.prepare("UPDATE visitor_sessions SET last_seen_at=?, user_id=?, event_count=event_count+1 WHERE visitor_id=?")
    .run(session.now, user?.id || null, session.id);
}

export function analyticsDashboard({ limit = 200 } = {}) {
  cleanup();
  const onlineSince = `-${ONLINE_MINUTES} minutes`;
  const counts = {
    online: Number(db.prepare("SELECT COUNT(*) count FROM visitor_sessions WHERE datetime(last_seen_at) >= datetime('now', ?)").get(onlineSince).count),
    onlineLoggedIn: Number(db.prepare("SELECT COUNT(*) count FROM visitor_sessions WHERE datetime(last_seen_at) >= datetime('now', ?) AND user_id IS NOT NULL").get(onlineSince).count),
    visitorsToday: Number(db.prepare("SELECT COUNT(*) count FROM visitor_sessions WHERE datetime(last_seen_at) >= datetime('now','start of day')").get().count),
    pageViewsToday: Number(db.prepare("SELECT COUNT(*) count FROM visitor_events WHERE event_type='page_view' AND datetime(occurred_at) >= datetime('now','start of day')").get().count),
    eventsToday: Number(db.prepare("SELECT COUNT(*) count FROM visitor_events WHERE datetime(occurred_at) >= datetime('now','start of day')").get().count),
  };
  const sessions = db.prepare(`SELECT s.*, u.login_id, u.nickname FROM visitor_sessions s LEFT JOIN community_users u ON u.id=s.user_id
    ORDER BY s.last_seen_at DESC LIMIT ?`).all(Math.min(500, limit));
  const events = db.prepare(`SELECT e.*, u.login_id, u.nickname FROM visitor_events e LEFT JOIN community_users u ON u.id=e.user_id
    ORDER BY e.id DESC LIMIT ?`).all(Math.min(1000, limit)).map((row) => ({ ...row, details: row.details_json ? JSON.parse(row.details_json) : {} }));
  const popularPages = db.prepare(`SELECT path, COUNT(*) count FROM visitor_events WHERE event_type='page_view' AND datetime(occurred_at) >= datetime('now','-24 hours') GROUP BY path ORDER BY count DESC LIMIT 20`).all();
  const searches = db.prepare(`SELECT search_type, details_json, COUNT(*) count, MAX(occurred_at) last_at FROM visitor_events WHERE event_type='search' GROUP BY search_type, details_json ORDER BY last_at DESC LIMIT 50`).all().map((row) => ({ ...row, details: JSON.parse(row.details_json || "{}") }));
  const lifetime = {
    totalVisits: Number(db.prepare("SELECT COALESCE(SUM(visit_count),0) count FROM visitor_lifetime_stats WHERE identity_type='ip'").get().count),
    uniqueIps: Number(db.prepare("SELECT COUNT(*) count FROM visitor_lifetime_stats WHERE identity_type='ip'").get().count),
    uniqueUsers: Number(db.prepare("SELECT COUNT(*) count FROM visitor_lifetime_stats WHERE identity_type='user'").get().count),
    ips: db.prepare(`SELECT identity_value ip_address, visit_count, first_seen_at, last_seen_at, last_visit_at
      FROM visitor_lifetime_stats WHERE identity_type='ip' ORDER BY visit_count DESC, last_seen_at DESC LIMIT 500`).all(),
    users: db.prepare(`SELECT s.user_id, u.login_id, u.nickname, s.last_ip_address, s.visit_count, s.first_seen_at, s.last_seen_at, s.last_visit_at
      FROM visitor_lifetime_stats s LEFT JOIN community_users u ON u.id=s.user_id
      WHERE s.identity_type='user' ORDER BY s.visit_count DESC, s.last_seen_at DESC LIMIT 500`).all(),
  };
  return { counts, lifetime, sessions, events, popularPages, searches, onlineMinutes: ONLINE_MINUTES, newVisitMinutes: NEW_VISIT_MINUTES, retentionDays: RETENTION_DAYS };
}

