import http from "node:http";
import { randomBytes } from "node:crypto";
import { config } from "./config.mjs";
import { isCollectionRunning, runCollection } from "./collector.mjs";
import { failAbandonedSnapshots, getActiveSnapshot } from "./database.mjs";
import { getPickRates, getPlayerSeasonMetadata, getUserProfile, homeRankingInsights, listAvailablePositions, listRankings, listTeamColors, portfolioMetrics, recentSnapshots, searchPlayers, searchRankings, suggestNicknames } from "./queries.mjs";
import { startScheduler } from "./scheduler.mjs";
import { listLogs, logger } from "./logger.mjs";
import { inspectSnapshotFreshness } from "./freshness.mjs";
import { listRecentMatches } from "./match-service.mjs";
import { fetchLiveUser, verifyGameNickname } from "./live-user-service.mjs";
import { getSquadProfile } from "./squad-profile-service.mjs";
import { fetchPlayerAbility, fetchPlayerAbilityAtAdaptation, fetchPlayerCareer } from "./player-detail-source.mjs";
import { fetchPlayerLastRecordedPrice, fetchPlayerPriceGraph } from "./player-price-source.mjs";
import { fetchOfficialTeamColorNames } from "./team-color-source.mjs";
import { adminDashboard, createBoard, deleteBoard, listAdminBoards, purgeExpiredBoards, restoreBoard, updateBoard } from "./admin-service.mjs";
import { analyticsDashboard, recordApiRequest, recordClientEvent, requestIp } from "./analytics-service.mjs";
import { activeRestrictions, createBan, createReport, moderationDashboard, revokeBan, updateReport } from "./moderation-service.mjs";
import {
  CommunityError,
  createComment,
  createPost,
  deleteComment,
  deletePost,
  updatePost,
  updateComment,
  getPost,
  listCommunityHighlights,
  listCommunityBoards,
  listNotifications,
  markNotificationRead,
  listPosts,
  purgeExpiredPosts,
  loginGoogleUser,
  registerUser,
  accountSettings,
  nicknameAvailability,
  updateAccountSettings,
  withdrawAccount,
  completeGoogleProfile,
  loginUser,
  logoutUser,
  requireUser,
  sessionCookie,
  sessionTokenFromRequest,
  userFromSessionToken,
} from "./community-service.mjs";

const googleStates = new Map();
purgeExpiredBoards();
purgeExpiredPosts();
const boardPurgeTimer = setInterval(() => { purgeExpiredBoards(); purgeExpiredPosts(); }, 60 * 60 * 1000);
boardPurgeTimer.unref();
function redirect(response, location, headers = {}) { response.writeHead(302, { location, "cache-control": "no-store", ...headers }); response.end(); }
function googleReady() { return Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri); }

function send(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": config.frontendOrigin,
    "access-control-allow-headers": "content-type, authorization, x-fc-visitor-id",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-credentials": "true",
    vary: "origin",
    ...headers,
  });
  response.end(status === 204 ? undefined : JSON.stringify(payload));
}

async function jsonBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new CommunityError(415, "JSON_REQUIRED", "JSON 형식으로 요청해 주세요.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new CommunityError(413, "PAYLOAD_TOO_LARGE", "요청 내용이 너무 큽니다.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new CommunityError(400, "INVALID_JSON", "올바른 JSON 형식이 아닙니다.");
  }
}

function positiveId(value, name) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id < 1) throw new CommunityError(400, "INVALID_ID", `${name} 번호가 올바르지 않습니다.`);
  return id;
}

function badRequest(message) {
  return new CommunityError(400, "BAD_REQUEST", message);
}

function integer(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  const value = raw == null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function adminAuthorized(request) {
  return Boolean(config.adminToken) && request.headers.authorization === `Bearer ${config.adminToken}`;
}

function requireAdminSession(user) {
  if (!user) throw new CommunityError(401, "LOGIN_REQUIRED", "관리자 로그인이 필요합니다.");
  if (!user.isAdmin) throw new CommunityError(403, "ADMIN_REQUIRED", "관리자만 접근할 수 있습니다.");
  return user;
}

function secureCookieRequest(request) {
  return config.frontendOrigin.startsWith("https://")
    || String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, null);
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    const origin = String(request.headers.origin || "");
    if (["POST", "PATCH", "DELETE"].includes(request.method || "") && origin && origin !== config.frontendOrigin) {
      throw new CommunityError(403, "ORIGIN_NOT_ALLOWED", "허용되지 않은 출처의 요청입니다.");
    }
    const sessionToken = sessionTokenFromRequest(request);
    const sessionUser = userFromSessionToken(sessionToken);
    const ipAddress = requestIp(request);
    const restrictions = activeRestrictions({ user: sessionUser, ip: ipAddress });
    const ban = restrictions.block;
    if (request.method === "GET" && url.pathname === "/api/access") {
      return send(response, ban ? 403 : 200, ban ? { blocked: true, ban, currentIp: ipAddress, nickname: sessionUser?.nickname || null } : { blocked: false });
    }
    if (ban && !(request.method === "POST" && url.pathname === "/api/admin/login")) {
      throw new CommunityError(403, "ACCESS_BANNED", ban.permanent ? "이용이 영구 정지되었습니다." : "이용이 일시 정지되었습니다.");
    }
    response.once("finish", () => {
      try { recordApiRequest({ request, user: sessionUser, url, status: response.statusCode }); }
      catch (analyticsError) { logger.warn("방문 분석", "API 요청 기록에 실패했습니다.", { error: String(analyticsError?.message || analyticsError) }); }
    });

    if (request.method === "POST" && url.pathname === "/api/analytics/events") {
      try {
        return send(response, 202, recordClientEvent({ request, user: sessionUser, input: await jsonBody(request) }));
      } catch (analyticsError) {
        if (String(analyticsError?.message) === "INVALID_ANALYTICS_EVENT") throw badRequest("지원하지 않는 방문 이벤트입니다.");
        throw analyticsError;
      }
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      return send(response, 200, { user: sessionUser });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const result = await registerUser(await jsonBody(request));
      return send(response, 201, { user: result.user }, { "set-cookie": sessionCookie(result.token, undefined, { secure: secureCookieRequest(request) }) });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const result = await loginUser(await jsonBody(request));
      return send(response, 200, { user: result.user }, { "set-cookie": sessionCookie(result.token, undefined, { secure: secureCookieRequest(request) }) });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/google") {
      if (!googleReady()) throw new CommunityError(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google 로그인이 아직 설정되지 않았습니다.");
      const state = randomBytes(32).toString("base64url");
      googleStates.set(state, Date.now() + 10 * 60_000);
      const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorization.search = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: config.googleRedirectUri, response_type: "code", scope: "openid", state, prompt: "select_account" }).toString();
      return redirect(response, authorization.toString());
    }

    if (request.method === "GET" && url.pathname === "/api/auth/google/callback") {
      const state = url.searchParams.get("state") || "";
      const expiresAt = googleStates.get(state);
      googleStates.delete(state);
      if (!expiresAt || expiresAt < Date.now()) throw new CommunityError(400, "INVALID_OAUTH_STATE", "Google 로그인 요청이 만료되었습니다. 다시 시도해 주세요.");
      const code = url.searchParams.get("code");
      if (!code) return redirect(response, `${config.frontendOrigin}/community?auth=error`);
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: config.googleRedirectUri, grant_type: "authorization_code" }) });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) throw new CommunityError(401, "GOOGLE_TOKEN_FAILED", "Google 인증을 완료하지 못했습니다.");
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
      const googleProfile = await profileResponse.json();
      if (!profileResponse.ok || !googleProfile.sub) throw new CommunityError(401, "GOOGLE_PROFILE_FAILED", "Google 계정 정보를 확인하지 못했습니다.");
      const result = loginGoogleUser(String(googleProfile.sub));
      return redirect(response, `${config.frontendOrigin}/community?auth=${result.user.profileComplete ? "ok" : "profile"}`, { "set-cookie": sessionCookie(result.token, undefined, { secure: secureCookieRequest(request) }) });
    }

    if (request.method === "PATCH" && url.pathname === "/api/auth/profile") {
      const user = requireUser(sessionToken);
      return send(response, 200, { user: completeGoogleProfile(user, await jsonBody(request)) });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      logoutUser(sessionToken);
      return send(response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    }

    if (request.method === "GET" && url.pathname === "/api/community/posts") {
      const offset = integer(url, "offset", 0, 0, 1000000);
      const limit = integer(url, "limit", 10, 1, 50);
      return send(response, 200, listPosts({ offset, limit, viewerId: sessionUser?.id || null, viewerRole: sessionUser?.role || "guest", category: url.searchParams.get("category") || "free", searchMode: url.searchParams.get("searchMode") || "title_content", query: url.searchParams.get("q") || "" }));
    }

    if (request.method === "GET" && url.pathname === "/api/community/boards") {
      return send(response, 200, { items: listCommunityBoards(sessionUser) });
    }

    if (request.method === "GET" && url.pathname === "/api/community/highlights") {
      return send(response, 200, listCommunityHighlights());
    }

    if (request.method === "POST" && url.pathname === "/api/community/posts") {
      if (restrictions.suspension) return send(response, 403, { code: "POSTING_SUSPENDED", message: "글쓰기 이용이 정지되어 있습니다.", restriction: { ...restrictions.suspension, nickname: sessionUser?.nickname || null } });
      const user = requireUser(sessionToken);
      return send(response, 201, createPost(user, await jsonBody(request)));
    }

    const postMatch = url.pathname.match(/^\/api\/community\/posts\/(\d+)$/);
    if (request.method === "GET" && postMatch) {
      const visitorHeader = String(request.headers["x-fc-visitor-id"] || "").trim();
      const viewerKey = sessionUser?.id
        ? `user:${sessionUser.id}`
        : /^[a-zA-Z0-9_-]{8,100}$/.test(visitorHeader) ? `visitor:${visitorHeader}` : `ip:${ipAddress}`;
      return send(response, 200, getPost(positiveId(postMatch[1], "게시글"), { viewerId: sessionUser?.id || null, viewerRole: sessionUser?.role || "guest", viewerKey }));
    }
    if (request.method === "DELETE" && postMatch) {
      const user = requireUser(sessionToken);
      deletePost(user, positiveId(postMatch[1], "게시글"));
      return send(response, 200, { ok: true });
    }

    if (request.method === "PATCH" && postMatch) {
      const user = requireUser(sessionToken);
      return send(response, 200, updatePost(user, positiveId(postMatch[1], "게시글"), await jsonBody(request)));
    }

    const commentCreateMatch = url.pathname.match(/^\/api\/community\/posts\/(\d+)\/comments$/);
    if (request.method === "POST" && commentCreateMatch) {
      if (restrictions.suspension) return send(response, 403, { code: "POSTING_SUSPENDED", message: "글쓰기 이용이 정지되어 있습니다.", restriction: { ...restrictions.suspension, nickname: sessionUser?.nickname || null } });
      const user = requireUser(sessionToken);
      return send(response, 201, createComment(user, positiveId(commentCreateMatch[1], "게시글"), await jsonBody(request)));
    }

    if (request.method === "GET" && url.pathname === "/api/notifications") {
      const user = requireUser(sessionToken);
      const filter = ["unread", "read"].includes(url.searchParams.get("filter")) ? url.searchParams.get("filter") : "all";
      const offset = integer(url, "offset", 0, 0, 1000000);
      const limit = integer(url, "limit", 20, 1, 50);
      return send(response, 200, listNotifications(user.id, { filter, offset, limit }));
    }

    const notificationReadMatch = url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (request.method === "POST" && notificationReadMatch) {
      const user = requireUser(sessionToken);
      markNotificationRead(user.id, positiveId(notificationReadMatch[1], "알림"));
      return send(response, 200, { ok: true });
    }

    const commentMatch = url.pathname.match(/^\/api\/community\/comments\/(\d+)$/);
    if (request.method === "DELETE" && commentMatch) {
      const user = requireUser(sessionToken);
      deleteComment(user.id, positiveId(commentMatch[1], "댓글"));
      return send(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      const activeSnapshot = getActiveSnapshot();
      return send(response, 200, {
        ok: true,
        ready: Boolean(activeSnapshot),
        collectionRunning: isCollectionRunning(),
        activeSnapshot,
        freshness: inspectSnapshotFreshness(activeSnapshot),
        schedulerEnabled: config.schedulerEnabled,
        configuredApiKeyCount: config.nexonApiKeys.length,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/portfolio/metrics") {
      return send(response, 200, portfolioMetrics());
    }

    if (request.method === "GET" && url.pathname === "/api/team-colors") {
      const collected = listTeamColors();
      const managersByName = new Map(collected.items.map((item) => [item.name, item.managers]));
      const officialNames = await fetchOfficialTeamColorNames();
      return send(response, 200, {
        snapshot: collected.snapshot,
        source: officialNames.length ? "fc-online" : "ranking-snapshot",
        items: (officialNames.length ? officialNames : collected.items.map((item) => item.name))
          .map((name) => ({ name, managers: managersByName.get(name) || 0 })),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/home-insights") {
      return send(response, 200, homeRankingInsights());
    }

    if (request.method === "GET" && url.pathname === "/api/positions") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw badRequest("rankStart cannot be greater than rankEnd.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const detailedPositions = url.searchParams.get("detailedPositions") !== "false";
      const result = listAvailablePositions({ rankStart, rankEnd, teamColor, detailedPositions });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/rankings") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw badRequest("rankStart cannot be greater than rankEnd.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const offset = integer(url, "offset", 0, 0, 10000);
      const limit = integer(url, "limit", 20, 1, 100);
      const result = listRankings({ rankStart, rankEnd, teamColor, offset, limit });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, {
        ...result,
        offset,
        limit,
        hasMore: offset + result.items.length < result.total,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/rankings/search") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw badRequest("nickname is required.");
      if (nickname.length > 50) throw badRequest("nickname must be 50 characters or fewer.");
      const result = searchRankings({ nickname, limit: 10 });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, { ...result, offset: 0, limit: 10, hasMore: false });
    }

    if (request.method === "GET" && url.pathname === "/api/users/suggestions") {
      const prefix = (url.searchParams.get("prefix") || "").trim();
      if (prefix.length > 50) throw badRequest("prefix must be 50 characters or fewer.");
      return send(response, 200, suggestNicknames(prefix, 10));
    }

    if (request.method === "GET" && url.pathname === "/api/users/profile") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw badRequest("nickname is required.");
      const result = getUserProfile(nickname);
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      if (!result.profile) return send(response, 404, { code: "USER_NOT_FOUND", message: "현재 랭킹에서 구단주를 찾지 못했습니다." });
      return send(response, 200, result);
    }
    if (request.method === "PATCH" && commentMatch) {
      const user = requireUser(sessionToken);
      return send(response, 200, updateComment(user.id, positiveId(commentMatch[1], "댓글"), await jsonBody(request)));
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      const result = await loginUser(await jsonBody(request));
      if (!result.user.isAdmin) {
        logoutUser(result.token);
        throw new CommunityError(403, "ADMIN_REQUIRED", "관리자 계정이 아닙니다.");
      }
      return send(response, 200, { user: result.user }, { "set-cookie": sessionCookie(result.token, undefined, { secure: secureCookieRequest(request) }) });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/session") {
      return send(response, 200, { user: requireAdminSession(sessionUser) });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
      requireAdminSession(sessionUser);
      return send(response, 200, { ...adminDashboard(), collectionRunning: isCollectionRunning() });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/analytics") {
      requireAdminSession(sessionUser);
      return send(response, 200, analyticsDashboard({ limit: integer(url, "limit", 200, 1, 500) }));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/moderation") {
      requireAdminSession(sessionUser);
      return send(response, 200, moderationDashboard());
    }

    if (request.method === "GET" && url.pathname === "/api/admin/boards") {
      return send(response, 200, { items: listAdminBoards(requireAdminSession(sessionUser)) });
    }
    if (request.method === "POST" && url.pathname === "/api/admin/boards") {
      return send(response, 201, createBoard(requireAdminSession(sessionUser), await jsonBody(request)));
    }
    const adminBoardMatch = url.pathname.match(/^\/api\/admin\/boards\/([^/]+)$/);
    if (request.method === "PATCH" && adminBoardMatch) {
      return send(response, 200, updateBoard(requireAdminSession(sessionUser), decodeURIComponent(adminBoardMatch[1]), await jsonBody(request)));
    }
    if (request.method === "DELETE" && adminBoardMatch) {
      return send(response, 200, deleteBoard(requireAdminSession(sessionUser), decodeURIComponent(adminBoardMatch[1])));
    }
    const adminBoardRestoreMatch = url.pathname.match(/^\/api\/admin\/boards\/([^/]+)\/restore$/);
    if (request.method === "POST" && adminBoardRestoreMatch) {
      return send(response, 200, restoreBoard(requireAdminSession(sessionUser), decodeURIComponent(adminBoardRestoreMatch[1])));
    }

    if (request.method === "POST" && url.pathname === "/api/admin/bans") {
      return send(response, 201, createBan(requireAdminSession(sessionUser), await jsonBody(request)));
    }

    const revokeBanMatch = url.pathname.match(/^\/api\/admin\/bans\/(\d+)\/revoke$/);
    if (request.method === "POST" && revokeBanMatch) {
      revokeBan(requireAdminSession(sessionUser), positiveId(revokeBanMatch[1], "차단"));
      return send(response, 200, { ok: true });
    }

    const reportStatusMatch = url.pathname.match(/^\/api\/admin\/reports\/(\d+)\/status$/);
    if (request.method === "POST" && reportStatusMatch) {
      updateReport(requireAdminSession(sessionUser), positiveId(reportStatusMatch[1], "신고"), await jsonBody(request));
      return send(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/community/reports") {
      return send(response, 201, createReport({ user: sessionUser, ip: ipAddress, input: await jsonBody(request) }));
    }

    if (request.method === "GET" && url.pathname === "/api/users/live-profile") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw badRequest("nickname is required.");
      if (nickname.length > 50) throw badRequest("nickname must be 50 characters or fewer.");
      const result = await fetchLiveUser(nickname);
      if (!result) return send(response, 404, { code: "USER_NOT_FOUND", message: "구단주를 찾지 못했습니다." });
      return send(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/users/squad-details") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw badRequest("nickname is required.");
      if (nickname.length > 50) throw badRequest("nickname must be 50 characters or fewer.");
      const result = await getSquadProfile(nickname);
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      if (!result.profile) return send(response, 404, { code: "USER_NOT_FOUND", message: "현재 랭킹에서 구단주를 찾지 못했습니다." });
      return send(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/users/matches") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw badRequest("nickname is required.");
      const offset = integer(url, "offset", 0, 0, 1000);
      const limit = integer(url, "limit", 20, 1, 20);
      const result = await listRecentMatches({ nickname, offset, limit });
      if (!result) return send(response, 404, { code: "OUID_NOT_FOUND", message: "구단주의 경기 식별 정보를 찾지 못했습니다." });
      return send(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/pick-rates") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw badRequest("rankStart cannot be greater than rankEnd.");
      const position = (url.searchParams.get("position") || "").trim().toUpperCase();
      if (!position) throw badRequest("position is required.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const offset = integer(url, "offset", 0, 0, 100000);
      const limit = integer(url, "limit", 3, 1, 30);
      const adaptation = integer(url, "adaptation", 0, 0, 5);
      const detailedPositions = url.searchParams.get("detailedPositions") !== "false";
      const result = getPickRates({ rankStart, rankEnd, teamColor, position, offset, limit, detailedPositions });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      const items = await Promise.all(result.items.map(async (item) => {
        const [ability, price] = await Promise.all([
          fetchPlayerAbilityAtAdaptation(item.spid, item.grade, adaptation),
          fetchPlayerLastRecordedPrice(item.spid, item.grade),
        ]);
        return { ...item, adaptation, ovr: ability?.ovr ?? null, price };
      }));
      return send(response, 200, {
        ...result,
        items,
        offset,
        limit,
        hasMore: offset + result.items.length < result.totalItems,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/account") {
      return send(response, 200, accountSettings(requireUser(sessionToken)));
    }

    if (request.method === "GET" && url.pathname === "/api/auth/nickname-availability") {
      return send(response, 200, nicknameAvailability(requireUser(sessionToken), url.searchParams.get("nickname") || ""));
    }

    if (request.method === "GET" && url.pathname === "/api/auth/game-nickname-availability") {
      requireUser(sessionToken);
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) return send(response, 200, { nickname: "", exists: true });
      return send(response, 200, { nickname, ...(await verifyGameNickname(nickname)) });
    }

    if (request.method === "PATCH" && url.pathname === "/api/auth/account") {
      const user = requireUser(sessionToken);
      const input = await jsonBody(request);
      const gameNickname = typeof input?.gameNickname === "string" ? input.gameNickname.trim() : "";
      const verification = await verifyGameNickname(gameNickname);
      return send(response, 200, updateAccountSettings(user, input, { gameNicknameExists: verification.exists }));
    }

    if (request.method === "DELETE" && url.pathname === "/api/auth/account") {
      const user = requireUser(sessionToken);
      const input = await jsonBody(request);
      if (input?.confirmed !== true) throw new CommunityError(400, "WITHDRAW_CONFIRM_REQUIRED", "회원탈퇴 확인이 필요합니다.");
      withdrawAccount(user);
      return send(response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    }

    if (request.method === "GET" && url.pathname === "/api/players/search") {
      const query = (url.searchParams.get("query") || "").trim();
      const limit = integer(url, "limit", 18, 1, 30);
      const grade = integer(url, "grade", 1, 1, 13);
      const adaptation = integer(url, "adaptation", 1, 0, 5);
      const teamColorLevel = integer(url, "teamColorLevel", 0, 0, 9);
      const searchedPlayers = searchPlayers(query, limit);
      const items = await Promise.all(searchedPlayers.map(async (item) => {
        const [player, price] = await Promise.all([
          fetchPlayerAbility(item.spid, grade, adaptation, teamColorLevel),
          fetchPlayerLastRecordedPrice(item.spid, grade),
        ]);
        return {
          ...item,
          image: player?.image || null,
          seasonImage: player?.seasonImage || item.seasonImage || null,
          nation: player?.nation || null,
          nationImage: player?.nationImage || null,
          ovr: player?.ovr ?? null,
          price: price || null,
        };
      }));
      return send(response, 200, { items });
    }

    if (request.method === "GET" && url.pathname === "/api/players/details") {
      const spid = (url.searchParams.get("spid") || "").trim();
      if (!/^\d{6,12}$/.test(spid)) throw badRequest("spid is invalid.");
      const grade = integer(url, "grade", 1, 0, 13);
      const adaptation = integer(url, "adaptation", 0, 0, 5);
      const teamColorLevel = integer(url, "teamColorLevel", 0, 0, 9);
      const [player, career, market] = await Promise.all([
        fetchPlayerAbility(spid, grade, adaptation, teamColorLevel),
        fetchPlayerCareer(spid, grade),
        fetchPlayerPriceGraph(spid, grade),
      ]);
      if (!player) return send(response, 502, { code: "PLAYER_DETAIL_UNAVAILABLE", message: "FC온라인 선수 정보를 불러오지 못했습니다." });
      const seasonMetadata = getPlayerSeasonMetadata(spid);
      return send(response, 200, { player: {
        ...player,
        season: seasonMetadata?.season || player.season,
        seasonImage: seasonMetadata?.seasonImage || player.seasonImage,
        career,
        market,
      } });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/snapshots") {
      if (!config.adminToken) return send(response, 503, { code: "ADMIN_TOKEN_NOT_CONFIGURED" });
      if (!adminAuthorized(request)) return send(response, 401, { code: "UNAUTHORIZED" });
      return send(response, 200, { items: recentSnapshots(20) });
    }

    if (request.method === "GET" && url.pathname === "/api/logs") {
      if (!config.adminToken) return send(response, 503, { code: "ADMIN_TOKEN_NOT_CONFIGURED" });
      if (!adminAuthorized(request)) return send(response, 401, { code: "UNAUTHORIZED" });
      const limit = integer(url, "limit", 200, 1, 500);
      const afterId = integer(url, "afterId", 0, 0, Number.MAX_SAFE_INTEGER);
      return send(response, 200, {
        collectionRunning: isCollectionRunning(),
        items: listLogs(limit, afterId),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/collect") {
      if (!adminAuthorized(request)) requireAdminSession(sessionUser);
      if (isCollectionRunning()) return send(response, 409, { code: "COLLECTION_RUNNING" });
      runCollection().catch((error) => console.error("[collector]", error));
      return send(response, 202, { accepted: true });
    }

    return send(response, 404, { code: "NOT_FOUND" });
  } catch (error) {
    if (error instanceof CommunityError) {
      return send(response, error.status, { code: error.code, message: error.message });
    }
    logger.error("API", "요청 처리 중 예기치 않은 오류가 발생했습니다.", {
      method: request.method,
      pathname: url.pathname,
      error: String(error?.message || error),
    });
    return send(response, 500, { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." });
  }
});

server.listen(config.port, config.host, () => {
  logger.success("서버", "백엔드 서버가 시작되었습니다.", { url: `http://${config.host}:${config.port}` });
  const abandonedCount = config.recoverAbandonedSnapshots ? failAbandonedSnapshots() : 0;
  if (abandonedCount > 0) {
    logger.warn("수집 복구", "이전 서버 종료로 미완료된 스냅샷을 실패 처리했습니다.", { count: abandonedCount });
  }
  startScheduler();
  const activeSnapshot = getActiveSnapshot();
  if (config.collectOnEmpty && !activeSnapshot) {
    if (config.nexonApiKeys.length === 0) {
      logger.warn("초기 집계", "DB가 비어 있지만 API 키가 없어 즉시 집계를 시작하지 못했습니다.");
    } else {
      logger.info("초기 집계", "DB에 활성 데이터가 없어 즉시 집계를 시작합니다.");
      runCollection().catch((error) => {
        logger.error("초기 집계", "서버 시작 직후 집계가 실패했습니다.", { error: String(error?.message || error) });
      });
    }
  } else if (activeSnapshot) {
    const freshness = inspectSnapshotFreshness(activeSnapshot);
    if (!freshness.fresh && config.collectOnStale && config.nexonApiKeys.length > 0) {
      logger.warn("신선도 검사", "활성 스냅샷이 최신 기대 시각보다 오래되어 즉시 재집계를 시작합니다.", {
        snapshotId: activeSnapshot.id,
        snapshotDataTime: freshness.snapshotDataTime,
        expectedDataTime: freshness.expectedDataTime,
      });
      runCollection().catch((error) => {
        logger.error("신선도 검사", "오래된 스냅샷의 재집계가 실패했습니다.", { error: String(error?.message || error) });
      });
    } else if (!freshness.fresh && config.collectOnStale) {
      logger.warn("신선도 검사", "활성 스냅샷이 오래됐지만 API 키가 없어 재집계를 시작하지 못했습니다.", freshness);
    } else if (!freshness.fresh) {
      logger.info("신선도 검사", "현재 서버에서는 오래된 데이터의 자동 재집계가 비활성화되어 있습니다.", freshness);
    } else {
      logger.info("신선도 검사", "활성 스냅샷이 최신 상태입니다.", {
        snapshotId: activeSnapshot.id,
        snapshotDataTime: freshness.snapshotDataTime,
        expectedDataTime: freshness.expectedDataTime,
      });
    }
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
