import { db } from "./database.mjs";
import { CommunityError } from "./community-service.mjs";

export const moderationReasons = [
  { code: "spam", label: "도배·스팸" },
  { code: "abuse", label: "욕설·비방·괴롭힘" },
  { code: "inappropriate", label: "부적절한 콘텐츠" },
  { code: "impersonation", label: "사칭·허위 정보" },
  { code: "security", label: "보안 위협·비정상 접근" },
  { code: "terms", label: "운영정책 위반" },
  { code: "other", label: "기타" },
];

function clean(value, max = 1000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function reason(input) {
  const code = clean(input?.reasonCode, 40);
  if (!moderationReasons.some((item) => item.code === code)) throw new CommunityError(400, "INVALID_REASON", "올바른 사유를 선택해 주세요.");
  const detail = clean(input?.reasonText, 1000);
  if (code === "other" && detail.length < 2) throw new CommunityError(400, "REASON_REQUIRED", "기타 사유를 입력해 주세요.");
  return { code, detail };
}
function positive(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new CommunityError(400, "INVALID_ID", `${name}이 올바르지 않습니다.`);
  return number;
}
function safeUrl(value) {
  const raw = clean(value, 1500);
  try {
    const url = new URL(raw, "https://fc-support.kr");
    if (!["fc-support.kr", "www.fc-support.kr", "localhost"].includes(url.hostname)) return "/#community";
    return `${url.pathname}${url.search}${url.hash}`.slice(0, 1500);
  } catch { return "/#community"; }
}

export function activeRestrictions({ user, ip }) {
  if (user?.isAdmin) return { block: null, suspension: null };
  const now = new Date().toISOString();
  db.prepare("UPDATE access_bans SET active=0 WHERE active=1 AND permanent=0 AND ends_at IS NOT NULL AND datetime(ends_at) <= datetime(?)").run(now);
  const values = [{ type: "ip", value: ip }];
  if (user?.id) values.push({ type: "user", value: String(user.id) });
  const restrictions = { block: null, suspension: null };
  for (const restrictionType of ["block", "suspend"]) {
    for (const target of values) {
      const row = db.prepare(`SELECT * FROM access_bans WHERE restriction_type=? AND target_type=? AND target_value=? AND active=1
        AND (permanent=1 OR ends_at IS NULL OR datetime(ends_at)>datetime(?)) ORDER BY id DESC LIMIT 1`).get(restrictionType, target.type, target.value, now);
      if (row) {
        restrictions[restrictionType === "block" ? "block" : "suspension"] = { id: Number(row.id), restrictionType: row.restriction_type, targetType: row.target_type, reasonCode: row.reason_code, reasonText: row.reason_text, startsAt: row.starts_at, permanent: Boolean(row.permanent), endsAt: row.ends_at };
        break;
      }
    }
  }
  return restrictions;
}

export function createBan(admin, input) {
  const restrictionType = clean(input?.restrictionType, 20);
  if (!["block", "suspend"].includes(restrictionType)) throw new CommunityError(400, "INVALID_RESTRICTION", "정지 또는 차단을 선택해 주세요.");
  const targetType = clean(input?.targetType, 20);
  if (!["ip", "user"].includes(targetType)) throw new CommunityError(400, "INVALID_TARGET", "차단 대상을 선택해 주세요.");
  let targetValue = clean(input?.targetValue, 200);
  let userId = null;
  if (targetType === "user") {
    const user = db.prepare("SELECT id FROM community_users WHERE login_id=? COLLATE NOCASE OR nickname=? COLLATE NOCASE OR CAST(id AS TEXT)=?").get(targetValue, targetValue, targetValue);
    if (!user) throw new CommunityError(404, "USER_NOT_FOUND", "차단할 회원을 찾지 못했습니다.");
    userId = Number(user.id); targetValue = String(userId);
    if (userId === Number(admin.id)) throw new CommunityError(400, "ADMIN_BAN_BLOCKED", "현재 관리자 계정은 차단할 수 없습니다.");
  } else if (!targetValue || targetValue.length > 100) throw new CommunityError(400, "INVALID_IP", "차단할 IP를 입력해 주세요.");
  const durationDays = Number(input?.durationDays);
  const permanent = input?.permanent === true;
  if (!permanent && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) throw new CommunityError(400, "INVALID_DURATION", "정지 기간을 선택해 주세요.");
  const selectedReason = reason(input);
  const now = new Date();
  const endsAt = permanent ? null : new Date(now.getTime() + durationDays * 86400000).toISOString();
  db.prepare("UPDATE access_bans SET active=0, revoked_at=? WHERE restriction_type=? AND target_type=? AND target_value=? AND active=1").run(now.toISOString(), restrictionType, targetType, targetValue);
  const result = db.prepare(`INSERT INTO access_bans
    (restriction_type,target_type,target_value,user_id,reason_code,reason_text,starts_at,ends_at,permanent,active,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`).run(restrictionType, targetType, targetValue, userId, selectedReason.code, selectedReason.detail || null, now.toISOString(), endsAt, permanent ? 1 : 0, admin.id, now.toISOString());
  return { id: Number(result.lastInsertRowid) };
}

export function revokeBan(admin, banId) {
  const result = db.prepare("UPDATE access_bans SET active=0, revoked_at=?, revoked_by=? WHERE id=? AND active=1").run(new Date().toISOString(), admin.id, positive(banId, "차단 번호"));
  if (!result.changes) throw new CommunityError(404, "BAN_NOT_FOUND", "활성 차단을 찾지 못했습니다.");
}

export function createReport({ user, ip, input }) {
  const targetType = clean(input?.targetType, 20);
  const targetId = positive(input?.targetId, "신고 대상 번호");
  if (!["post", "comment"].includes(targetType)) throw new CommunityError(400, "INVALID_TARGET", "신고 대상을 확인해 주세요.");
  const selectedReason = reason(input);
  const target = targetType === "post"
    ? db.prepare(`SELECT p.author_id, u.nickname author_nickname, p.title content_title, p.content content_body FROM community_posts p JOIN community_users u ON u.id=p.author_id WHERE p.id=?`).get(targetId)
    : db.prepare(`SELECT c.author_id, u.nickname author_nickname, NULL content_title, c.content content_body FROM community_comments c JOIN community_users u ON u.id=c.author_id WHERE c.id=?`).get(targetId);
  if (!target) throw new CommunityError(404, "REPORT_TARGET_NOT_FOUND", "신고할 내용을 찾지 못했습니다.");
  const reporterKey = user?.id ? `user:${user.id}` : `ip:${ip}`;
  const duplicate = db.prepare(`SELECT 1 FROM content_reports WHERE target_type=? AND target_id=?
    AND (CASE WHEN reporter_user_id IS NOT NULL THEN 'user:'||reporter_user_id ELSE 'ip:'||reporter_ip END)=?
    AND datetime(created_at)>=datetime('now','-24 hours')`).get(targetType, targetId, reporterKey);
  if (duplicate) throw new CommunityError(409, "ALREADY_REPORTED", "같은 내용은 하루에 한 번만 신고할 수 있습니다.");
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO content_reports
    (target_type,target_id,reporter_user_id,reporter_ip,reason_code,reason_text,page_url,author_id,author_nickname,content_title,content_body,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(targetType, targetId, user?.id || null, ip, selectedReason.code, selectedReason.detail || null, safeUrl(input?.pageUrl), target.author_id, target.author_nickname, target.content_title, target.content_body, now, now);
  return { id: Number(result.lastInsertRowid) };
}

export function updateReport(admin, reportId, input) {
  const status = clean(input?.status, 20);
  if (!["reviewing", "resolved", "rejected"].includes(status)) throw new CommunityError(400, "INVALID_STATUS", "처리 상태가 올바르지 않습니다.");
  const result = db.prepare("UPDATE content_reports SET status=?, admin_note=?, updated_at=? WHERE id=?").run(status, clean(input?.adminNote, 1000) || null, new Date().toISOString(), positive(reportId, "신고 번호"));
  if (!result.changes) throw new CommunityError(404, "REPORT_NOT_FOUND", "신고를 찾지 못했습니다.");
}

export function moderationDashboard() {
  const bans = db.prepare(`SELECT b.*, u.login_id, u.nickname, a.nickname created_by_nickname FROM access_bans b
    LEFT JOIN community_users u ON u.id=b.user_id LEFT JOIN community_users a ON a.id=b.created_by ORDER BY b.id DESC LIMIT 500`).all();
  const reports = db.prepare(`SELECT r.*, reporter.login_id reporter_login_id, reporter.nickname reporter_nickname
    FROM content_reports r LEFT JOIN community_users reporter ON reporter.id=r.reporter_user_id ORDER BY r.id DESC LIMIT 500`).all();
  return { reasons: moderationReasons, bans, reports };
}

