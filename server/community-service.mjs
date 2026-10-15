import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, transaction } from "./database.mjs";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const TERMS_VERSION = "2026-09-22";
const PRIVACY_VERSION = "2026-09-22";
let lastSessionCleanup = 0;
export const sessionCookieName = "fc_support_session";
export const securityQuestions = [
  "어린 시절 가장 기억에 남는 장소는 어디인가요?",
  "처음 좋아했던 게임 캐릭터의 이름은 무엇인가요?",
  "나만 기억하는 어린 시절 별명은 무엇인가요?",
  "가장 기억에 남는 선생님의 성함은 무엇인가요?",
  "처음 직접 구입한 물건은 무엇인가요?",
];

export class CommunityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requiredText(value, name, min, max) {
  if (typeof value !== "string") throw new CommunityError(400, "INVALID_INPUT", `${name}을(를) 입력해 주세요.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new CommunityError(400, "INVALID_INPUT", `${name}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return text;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function passwordHash(password, salt) {
  return Buffer.from(await scrypt(password, salt, 64)).toString("hex");
}

function publicUser(row) {
  if (!row) return null;
  const role = row.role || (row.is_admin ? "admin" : "member");
  return { id: Number(row.id), loginId: row.login_id, nickname: row.nickname, gameNickname: row.game_nickname || null, gameNicknamePublic: Boolean(row.game_nickname_public), profileComplete: Boolean(row.profile_complete), role, isAdmin: role === "admin" || role === "super_admin", isSuperAdmin: role === "super_admin", createdAt: row.created_at };
}

function postRow(row, viewerId = null) {
  const isDeleted = Boolean(row.deleted_at);
  const canManage = !isDeleted && viewerId != null && (Number(row.author_id) === Number(viewerId) || (Boolean(row.board_managers_edit_all) && Boolean(row.viewer_is_admin)));
  return {
    id: Number(row.id),
    category: row.category || "free",
    isSecret: Boolean(row.is_secret),
    isDeleted,
    title: row.title,
    content: row.content,
    excerpt: row.content.length > 140 ? `${row.content.slice(0, 140)}…` : row.content,
    viewCount: Number(row.view_count),
    commentCount: Number(row.comment_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: Number(row.author_id), nickname: row.author_nickname, gameNickname: row.author_game_nickname_public ? row.author_game_nickname : null },
    canEdit: canManage,
    canDelete: canManage,
  };
}

function notificationRow(row) {
  return {
    id: Number(row.id),
    type: row.type,
    postId: Number(row.post_id),
    commentId: row.comment_id != null ? Number(row.comment_id) : null,
    category: row.category,
    postTitle: row.post_title,
    actorNickname: row.actor_nickname,
    preview: row.preview,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

function createNotification({ userId, type, postId, commentId = null, category, postTitle, actorNickname, preview }) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, post_id, comment_id, category, post_title, actor_nickname, preview, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, type, postId, commentId, category, postTitle, actorNickname, preview, new Date().toISOString());
}

export function listNotifications(userId, { filter = "all", offset = 0, limit = 20 } = {}) {
  const clause = filter === "unread" ? "AND is_read = 0" : filter === "read" ? "AND is_read = 1" : "";
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? ${clause}`).get(userId).count);
  const unreadCount = Number(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0").get(userId).count);
  const items = db.prepare(`SELECT * FROM notifications WHERE user_id = ? ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(userId, limit, offset).map(notificationRow);
  return { items, total, unreadCount, offset, limit, hasMore: offset + items.length < total };
}

export function markNotificationRead(userId, notificationId) {
  const result = db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(notificationId, userId);
  if (!result.changes) throw new CommunityError(404, "NOTIFICATION_NOT_FOUND", "알림을 찾을 수 없습니다.");
}

function commentRow(row, viewerId = null) {
  return {
    id: Number(row.id),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: Number(row.author_id), nickname: row.author_nickname, gameNickname: row.author_game_nickname_public ? row.author_game_nickname : null },
    canEdit: viewerId != null && Number(row.author_id) === Number(viewerId),
    canDelete: viewerId != null && Number(row.author_id) === Number(viewerId),
  };
}

export function sessionCookie(token, maxAge = SESSION_DAYS * 24 * 60 * 60, { secure = false } = {}) {
  const value = token ? `${sessionCookieName}=${token}` : `${sessionCookieName}=`;
  return `${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function sessionTokenFromRequest(request) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === sessionCookieName) return cookie.slice(separator + 1).trim();
  }
  return "";
}

export function userFromSessionToken(token) {
  if (!token) return null;
  if (Date.now() - lastSessionCleanup >= SESSION_CLEANUP_INTERVAL_MS) {
    db.prepare("DELETE FROM community_sessions WHERE expires_at <= ?").run(new Date().toISOString());
    lastSessionCleanup = Date.now();
  }
  const row = db.prepare(`
    SELECT u.id, u.login_id, u.nickname, u.game_nickname, u.game_nickname_public, u.profile_complete, u.is_admin, u.role, u.created_at
    FROM community_sessions s
    JOIN community_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), new Date().toISOString());
  return publicUser(row);
}

export function requireUser(token) {
  const user = userFromSessionToken(token);
  if (!user) throw new CommunityError(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  return user;
}

function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO community_sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash(token), userId, createdAt.toISOString(), expiresAt.toISOString());
  return token;
}

export function loginGoogleUser(googleSub) {
  const sub = requiredText(googleSub, "Google 계정", 3, 255);
  let row = db.prepare("SELECT * FROM community_users WHERE google_sub=?").get(sub);
  if (!row) {
    const key = createHash("sha256").update(sub).digest("hex").slice(0, 20);
    const now = new Date().toISOString();
    let nickname = "";
    do { nickname = `FC${randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 6)}`; }
    while (nickname.length !== 8 || db.prepare("SELECT 1 FROM community_users WHERE nickname=? COLLATE NOCASE").get(nickname));
    const result = db.prepare(`INSERT INTO community_users
      (login_id,nickname,password_hash,password_salt,google_sub,profile_complete,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,?)`).run(`google_${key}`, nickname, "", "", sub, now, now);
    row = db.prepare("SELECT * FROM community_users WHERE id=?").get(result.lastInsertRowid);
  }
  if (row.withdrawn_at) throw new CommunityError(403, "WITHDRAWN_ACCOUNT", "탈퇴한 계정입니다.");
  return { user: publicUser(row), token: createSession(Number(row.id)) };
}

function accountUser(id) {
  return db.prepare("SELECT * FROM community_users WHERE id=?").get(id);
}

export function nicknameAvailability(user, nickname) {
  const value = requiredText(nickname, "사이트 닉네임", 2, 16);
  if (!/^[가-힣a-zA-Z0-9]+$/u.test(value)) throw new CommunityError(400, "INVALID_NICKNAME", "닉네임은 공백 없이 한글, 영문, 숫자만 사용할 수 있습니다.");
  const taken = db.prepare("SELECT 1 FROM community_users WHERE nickname=? COLLATE NOCASE AND id<>? AND withdrawn_at IS NULL").get(value, user.id);
  return { nickname: value, available: !taken };
}

export function accountSettings(user) {
  const row = accountUser(user.id);
  return { user: publicUser(row), nicknameChangedAt: row.nickname_changed_at || null, nicknameChangeAvailableAt: row.nickname_changed_at ? new Date(new Date(row.nickname_changed_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null };
}

export function updateAccountSettings(user, input, { gameNicknameExists = true } = {}) {
  const row = accountUser(user.id);
  const nickname = requiredText(input?.nickname, "사이트 닉네임", 2, 16);
  const gameNickname = typeof input?.gameNickname === "string" ? input.gameNickname.trim() : "";
  const now = new Date();
  if (!/^[가-힣a-zA-Z0-9]+$/u.test(nickname)) throw new CommunityError(400, "INVALID_NICKNAME", "닉네임은 공백 없이 한글, 영문, 숫자만 사용할 수 있습니다.");
  if (gameNickname.length > 20) throw new CommunityError(400, "INVALID_GAME_NICKNAME", "게임 닉네임은 20자 이하로 입력해 주세요.");
  if (gameNickname && !gameNicknameExists) throw new CommunityError(400, "GAME_NICKNAME_NOT_FOUND", "존재하지 않는 게임 닉네임입니다.");
  if (nickname !== row.nickname) {
    const availableAt = row.nickname_changed_at ? new Date(new Date(row.nickname_changed_at).getTime() + 7 * 24 * 60 * 60 * 1000) : null;
    if (availableAt && availableAt > now) throw new CommunityError(429, "NICKNAME_COOLDOWN", `사이트 닉네임은 ${availableAt.toISOString().slice(0, 10)} 이후 변경할 수 있습니다.`);
    if (!nicknameAvailability(user, nickname).available) throw new CommunityError(409, "NICKNAME_EXISTS", "이미 사용 중인 닉네임입니다.");
  }
  db.prepare("UPDATE community_users SET nickname=?,game_nickname=?,game_nickname_public=?,nickname_changed_at=?,updated_at=? WHERE id=?").run(nickname, gameNickname || null, input?.gameNicknamePublic === true ? 1 : 0, nickname === row.nickname ? row.nickname_changed_at : now.toISOString(), now.toISOString(), user.id);
  return accountSettings(user);
}

export function withdrawAccount(user) {
  if (user.isAdmin) throw new CommunityError(403, "WITHDRAW_NOT_ALLOWED", "관리자 계정은 탈퇴할 수 없습니다.");
  const row = accountUser(user.id);
  const now = new Date().toISOString();
  db.prepare("UPDATE community_users SET nickname=?,game_nickname=NULL,game_nickname_public=0,withdrawn_at=?,updated_at=? WHERE id=?").run(`탈퇴회원${row.id}`, now, now, row.id);
  db.prepare("DELETE FROM community_sessions WHERE user_id=?").run(user.id);
  return { ok: true };
}

export function completeGoogleProfile(user, input) {
  if (!user || user.isAdmin) throw new CommunityError(403, "PROFILE_NOT_ALLOWED", "일반 회원 프로필만 설정할 수 있습니다.");
  const nickname = requiredText(input?.nickname, "사이트 닉네임", 2, 16);
  const gameNickname = requiredText(input?.gameNickname, "게임 닉네임", 2, 20);
  if (!/^[가-힣a-zA-Z0-9]+$/u.test(nickname)) throw new CommunityError(400, "INVALID_NICKNAME", "닉네임은 공백 없이 한글, 영문, 숫자만 사용할 수 있습니다.");
  const duplicate = db.prepare("SELECT 1 FROM community_users WHERE nickname=? COLLATE NOCASE AND id<>?").get(nickname, user.id);
  if (duplicate) throw new CommunityError(409, "NICKNAME_EXISTS", "이미 사용 중인 닉네임입니다.");
  db.prepare("UPDATE community_users SET nickname=?,game_nickname=?,game_nickname_public=?,profile_complete=1,updated_at=? WHERE id=? AND google_sub IS NOT NULL")
    .run(nickname, gameNickname, input?.gameNicknamePublic === true ? 1 : 0, new Date().toISOString(), user.id);
  return publicUser(db.prepare("SELECT * FROM community_users WHERE id=?").get(user.id));
}

export async function registerUser(input) {
  if (input?.termsAccepted !== true || input?.privacyAccepted !== true) {
    throw new CommunityError(400, "CONSENT_REQUIRED", "회원가입을 위해 이용약관과 개인정보 수집·이용에 모두 동의해 주세요.");
  }
  const loginId = requiredText(input?.loginId, "아이디", 4, 20);
  const nickname = requiredText(input?.nickname, "닉네임", 2, 16);
  const password = requiredText(input?.password, "비밀번호", 8, 72);
  const gameNickname = requiredText(input?.gameNickname, "게임 닉네임", 2, 20);
  const securityQuestion = requiredText(input?.securityQuestion, "본인확인 질문", 5, 100);
  const securityAnswer = requiredText(input?.securityAnswer, "본인확인 답변", 2, 100).toLocaleLowerCase("ko-KR");
  if (!securityQuestions.includes(securityQuestion)) throw new CommunityError(400, "INVALID_SECURITY_QUESTION", "목록에서 본인확인 질문을 선택해 주세요.");
  if (!/^[a-zA-Z0-9_]+$/.test(loginId)) {
    throw new CommunityError(400, "INVALID_LOGIN_ID", "아이디는 영문, 숫자, 밑줄만 사용할 수 있습니다.");
  }
  if (!/^[가-힣a-zA-Z0-9]+$/u.test(nickname)) {
    throw new CommunityError(400, "INVALID_NICKNAME", "닉네임은 공백 없이 한글, 영문, 숫자만 사용할 수 있습니다.");
  }
  if (db.prepare("SELECT 1 FROM community_users WHERE login_id = ? COLLATE NOCASE").get(loginId)) {
    throw new CommunityError(409, "LOGIN_ID_EXISTS", "이미 사용 중인 아이디입니다.");
  }
  if (db.prepare("SELECT 1 FROM community_users WHERE nickname = ? COLLATE NOCASE").get(nickname)) {
    throw new CommunityError(409, "NICKNAME_EXISTS", "이미 사용 중인 닉네임입니다.");
  }

  const salt = randomBytes(16).toString("hex");
  const hash = await passwordHash(password, salt);
  const answerSalt = randomBytes(16).toString("hex");
  const answerHash = await passwordHash(securityAnswer, answerSalt);
  const now = new Date().toISOString();
  try {
    return transaction(() => {
      const result = db.prepare(`
        INSERT INTO community_users (login_id, nickname, password_hash, password_salt, game_nickname, game_nickname_public, security_question, security_answer_hash, security_answer_salt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(loginId, nickname, hash, salt, gameNickname, input?.gameNicknamePublic === true ? 1 : 0, securityQuestion, answerHash, answerSalt, now, now);
      db.prepare(`
        INSERT INTO community_user_consents (user_id, terms_version, privacy_version, agreed_at)
        VALUES (?, ?, ?, ?)
      `).run(result.lastInsertRowid, TERMS_VERSION, PRIVACY_VERSION, now);
      const user = publicUser(db.prepare("SELECT id, login_id, nickname, game_nickname, game_nickname_public, is_admin, role, created_at FROM community_users WHERE id = ?").get(result.lastInsertRowid));
      return { user, token: createSession(user.id) };
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("community_users.login_id")) {
      throw new CommunityError(409, "LOGIN_ID_EXISTS", "이미 사용 중인 아이디입니다.");
    }
    if (message.includes("community_users.nickname")) {
      throw new CommunityError(409, "NICKNAME_EXISTS", "이미 사용 중인 닉네임입니다.");
    }
    throw error;
  }
}

export function recoveryQuestion({ type, identifier }) {
  const value = requiredText(identifier, type === "id" ? "사이트 닉네임" : "아이디", 2, 20);
  const row = type === "id"
    ? db.prepare("SELECT security_question FROM community_users WHERE nickname=? COLLATE NOCASE").get(value)
    : db.prepare("SELECT security_question FROM community_users WHERE login_id=? COLLATE NOCASE").get(value);
  if (!row?.security_question) throw new CommunityError(404, "RECOVERY_NOT_FOUND", "일치하는 복구 정보를 찾을 수 없습니다.");
  return { question: row.security_question };
}

export async function recoverAccount(input) {
  const type = input?.type === "id" ? "id" : "password";
  const identifier = requiredText(input?.identifier, type === "id" ? "사이트 닉네임" : "아이디", 2, 20);
  const answer = requiredText(input?.answer, "본인확인 답변", 2, 100).toLocaleLowerCase("ko-KR");
  const row = type === "id" ? db.prepare("SELECT * FROM community_users WHERE nickname=? COLLATE NOCASE").get(identifier) : db.prepare("SELECT * FROM community_users WHERE login_id=? COLLATE NOCASE").get(identifier);
  if (!row?.security_answer_hash || (row.recovery_locked_until && new Date(row.recovery_locked_until) > new Date())) throw new CommunityError(429, "RECOVERY_LOCKED", "복구 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요.");
  const actual = Buffer.from(await passwordHash(answer, row.security_answer_salt), "hex");
  const expected = Buffer.from(row.security_answer_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    const failures = Number(row.recovery_failures || 0) + 1;
    const locked = failures >= 5 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
    db.prepare("UPDATE community_users SET recovery_failures=?, recovery_locked_until=? WHERE id=?").run(locked ? 0 : failures, locked, row.id);
    throw new CommunityError(400, "INVALID_RECOVERY_ANSWER", "본인확인 답변이 올바르지 않습니다.");
  }
  db.prepare("UPDATE community_users SET recovery_failures=0,recovery_locked_until=NULL WHERE id=?").run(row.id);
  if (type === "id") return { loginId: row.login_id };
  const password = requiredText(input?.newPassword, "새 비밀번호", 8, 72);
  const salt = randomBytes(16).toString("hex");
  db.prepare("UPDATE community_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?").run(await passwordHash(password, salt), salt, new Date().toISOString(), row.id);
  db.prepare("DELETE FROM community_sessions WHERE user_id=?").run(row.id);
  return { ok: true };
}

export async function loginUser(input) {
  const loginId = requiredText(input?.loginId, "아이디", 4, 20);
  const password = requiredText(input?.password, "비밀번호", 8, 72);
  const row = db.prepare("SELECT * FROM community_users WHERE login_id = ? COLLATE NOCASE").get(loginId);
  if (!row) throw new CommunityError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
  const actual = Buffer.from(await passwordHash(password, row.password_salt), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new CommunityError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  return { user: publicUser(row), token: createSession(Number(row.id)) };
}

export async function upsertAdminUser({ loginId, password, nickname = "FC-SUPPORT" }) {
  const normalizedLoginId = requiredText(loginId, "아이디", 4, 20);
  const normalizedPassword = requiredText(password, "비밀번호", 8, 72);
  const normalizedNickname = requiredText(nickname, "닉네임", 2, 20);
  if (!/^[a-zA-Z0-9_]+$/.test(normalizedLoginId)) {
    throw new CommunityError(400, "INVALID_LOGIN_ID", "아이디는 영문, 숫자, 밑줄만 사용할 수 있습니다.");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = await passwordHash(normalizedPassword, salt);
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM community_users WHERE login_id = ? COLLATE NOCASE").get(normalizedLoginId);
  if (existing) {
    db.prepare("UPDATE community_users SET nickname = ?, password_hash = ?, password_salt = ?, is_admin = 1, role = 'super_admin', updated_at = ? WHERE id = ?")
      .run(normalizedNickname, hash, salt, now, existing.id);
    db.prepare("DELETE FROM community_sessions WHERE user_id = ?").run(existing.id);
    return Number(existing.id);
  }
  const result = db.prepare(`
    INSERT INTO community_users (login_id, nickname, password_hash, password_salt, is_admin, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'super_admin', ?, ?)
  `).run(normalizedLoginId, normalizedNickname, hash, salt, now, now);
  return Number(result.lastInsertRowid);
}

export function logoutUser(token) {
  if (token) db.prepare("DELETE FROM community_sessions WHERE token_hash = ?").run(tokenHash(token));
}

const searchModes = new Set(["title", "title_content", "content", "author"]);

function roleLevel(role) {
  return role === "super_admin" ? 3 : role === "admin" ? 2 : role === "member" ? 1 : 0;
}

function boardRow(row) {
  return row ? {
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: Number(row.sort_order),
    showInNavigation: Boolean(row.show_in_navigation),
    readLevel: Number(row.read_level),
    writeLevel: Number(row.write_level),
    commentLevel: Number(row.comment_level),
    commentsEnabled: Boolean(row.comments_enabled),
    allowSecret: Boolean(row.allow_secret),
    secretReadLevel: Number(row.secret_read_level),
    visibilityMode: row.visibility_mode,
    managersEditAll: Boolean(row.managers_edit_all),
    deletedAt: row.deleted_at || null,
    purgeAt: row.purge_at || null,
  } : null;
}

function activeBoard(slug) {
  const value = String(slug || "").trim().toLowerCase();
  const row = db.prepare("SELECT * FROM community_boards WHERE slug = ? COLLATE NOCASE AND deleted_at IS NULL").get(value);
  if (!row) throw new CommunityError(404, "BOARD_NOT_FOUND", "게시판을 찾을 수 없습니다.");
  return boardRow(row);
}

export function listCommunityBoards(user = null) {
  const level = roleLevel(user?.role);
  return db.prepare("SELECT * FROM community_boards WHERE deleted_at IS NULL AND read_level <= ? ORDER BY sort_order, slug")
    .all(level).map(boardRow);
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function listPosts({ offset = 0, limit = 20, viewerId = null, viewerRole = "guest", category = "free", searchMode = "title_content", query = "" } = {}) {
  const board = activeBoard(category);
  if (roleLevel(viewerRole) < board.readLevel) throw new CommunityError(403, "BOARD_READ_FORBIDDEN", "이 게시판을 열람할 권한이 없습니다.");
  if (!searchModes.has(searchMode)) throw new CommunityError(400, "INVALID_SEARCH_MODE", "검색 조건이 올바르지 않습니다.");
  const viewerIsAdmin = roleLevel(viewerRole) >= 2;
  const deletedScopeSql = viewerIsAdmin ? "" : " AND p.deleted_at IS NULL";
  const ownerScopeSql = board.visibilityMode === "author_admin" && !viewerIsAdmin ? " AND p.author_id = ?" : "";
  const ownerScopeArgs = board.visibilityMode === "author_admin" && !viewerIsAdmin ? [viewerId ?? -1] : [];
  const canReadAllSecrets = roleLevel(viewerRole) >= board.secretReadLevel;
  const secretScopeSql = board.allowSecret && !canReadAllSecrets ? " AND (p.is_secret = 0 OR p.author_id = ?)" : "";
  const secretScopeArgs = board.allowSecret && !canReadAllSecrets ? [viewerId ?? -1] : [];
  const keyword = String(query || "").trim();
  const searchSql = !keyword ? "" : searchMode === "title" ? " AND p.title LIKE ? ESCAPE '\\'" : searchMode === "content" ? " AND p.content LIKE ? ESCAPE '\\'" : searchMode === "author" ? " AND u.nickname LIKE ? ESCAPE '\\'" : " AND (p.title LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')";
  const pattern = `%${escapeLikePattern(keyword)}%`;
  const searchArgs = !keyword ? [] : searchMode === "title_content" ? [pattern, pattern] : [pattern];
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM community_posts p JOIN community_users u ON u.id=p.author_id WHERE p.category=?${deletedScopeSql}${ownerScopeSql}${secretScopeSql}${searchSql}`).get(category, ...ownerScopeArgs, ...secretScopeArgs, ...searchArgs).count);
  const rows = db.prepare(`
    SELECT p.*, u.nickname AS author_nickname, u.game_nickname AS author_game_nickname, u.game_nickname_public AS author_game_nickname_public, COUNT(c.id) AS comment_count,
      ? AS board_managers_edit_all,
      EXISTS(SELECT 1 FROM community_users vu WHERE vu.id = ? AND (vu.is_admin = 1 OR vu.role IN ('admin', 'super_admin'))) AS viewer_is_admin
    FROM community_posts p
    JOIN community_users u ON u.id = p.author_id
    LEFT JOIN community_comments c ON c.post_id = p.id
    WHERE p.category = ?${deletedScopeSql}${ownerScopeSql}${secretScopeSql}${searchSql}
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(board.managersEditAll ? 1 : 0, viewerId, category, ...ownerScopeArgs, ...secretScopeArgs, ...searchArgs, limit, offset);
  return { total, items: rows.map((row) => postRow(row, viewerId)), offset, limit, hasMore: offset + rows.length < total };
}

export function listCommunityHighlights() {
  const select = `
    SELECT p.*, u.nickname AS author_nickname, u.game_nickname AS author_game_nickname,
      u.game_nickname_public AS author_game_nickname_public, COUNT(c.id) AS comment_count,
      0 AS viewer_is_admin
    FROM community_posts p
    JOIN community_boards b ON b.slug = p.category AND b.deleted_at IS NULL
    JOIN community_users u ON u.id = p.author_id
    LEFT JOIN community_comments c ON c.post_id = p.id
  `;
  const notices = db.prepare(`${select}
    WHERE p.category = 'notice' AND p.is_secret = 0 AND p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 5
  `).all();
  const recent = db.prepare(`${select}
    WHERE p.category IN ('free', 'tip') AND p.is_secret = 0 AND p.deleted_at IS NULL AND datetime(p.created_at) >= datetime('now', '-7 days')
    GROUP BY p.id
    ORDER BY (p.view_count + COUNT(c.id)) DESC, p.created_at DESC, p.id DESC
    LIMIT 5
  `).all();
  const selectedIds = recent.map((row) => Number(row.id));
  let popular = recent;
  if (popular.length < 5) {
    const placeholders = selectedIds.length ? selectedIds.map(() => "?").join(",") : "0";
    const fallback = db.prepare(`${select}
      WHERE p.category IN ('free', 'tip') AND p.is_secret = 0 AND p.deleted_at IS NULL AND p.id NOT IN (${placeholders})
      GROUP BY p.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ?
    `).all(...selectedIds, 5 - popular.length);
    popular = [...popular, ...fallback];
  }
  return {
    notice: notices[0] ? postRow(notices[0]) : null,
    notices: notices.map((row) => postRow(row)),
    popular: popular.map((row) => postRow(row)),
  };
}

export function getPost(postId, { viewerId = null, viewerRole = "guest", viewerKey = null, incrementView = true } = {}) {
  const row = db.prepare(`
    SELECT p.*, u.nickname AS author_nickname, u.game_nickname AS author_game_nickname, u.game_nickname_public AS author_game_nickname_public, COUNT(c.id) AS comment_count,
      b.read_level AS board_read_level, b.comments_enabled AS board_comments_enabled, b.allow_secret AS board_allow_secret,
      b.secret_read_level AS board_secret_read_level, b.visibility_mode AS board_visibility_mode, b.managers_edit_all AS board_managers_edit_all,
      EXISTS(SELECT 1 FROM community_users vu WHERE vu.id = ? AND (vu.is_admin = 1 OR vu.role IN ('admin', 'super_admin'))) AS viewer_is_admin
    FROM community_posts p
    JOIN community_boards b ON b.slug = p.category AND b.deleted_at IS NULL
    JOIN community_users u ON u.id = p.author_id
    LEFT JOIN community_comments c ON c.post_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(viewerId, postId);
  if (!row) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  if (row.deleted_at && !row.viewer_is_admin) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  if (roleLevel(viewerRole) < Number(row.board_read_level)) throw new CommunityError(403, "BOARD_READ_FORBIDDEN", "이 게시판을 열람할 권한이 없습니다.");
  if (row.board_visibility_mode === "author_admin" && !row.viewer_is_admin && Number(row.author_id) !== Number(viewerId)) {
    throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  }
  if (row.is_secret && roleLevel(viewerRole) < Number(row.board_secret_read_level) && Number(row.author_id) !== Number(viewerId)) {
    throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  }
  if (incrementView && viewerKey) {
    const view = db.prepare("INSERT OR IGNORE INTO community_post_views (post_id, viewer_key, viewed_at) VALUES (?, ?, ?)").run(postId, viewerKey, new Date().toISOString());
    if (view.changes) {
      db.prepare("UPDATE community_posts SET view_count = view_count + 1 WHERE id = ?").run(postId);
      row.view_count = Number(row.view_count) + 1;
    }
  }
  const comments = !row.board_comments_enabled ? [] : db.prepare(`
    SELECT c.*, u.nickname AS author_nickname, u.game_nickname AS author_game_nickname, u.game_nickname_public AS author_game_nickname_public
    FROM community_comments c
    JOIN community_users u ON u.id = c.author_id
    WHERE c.post_id = ?
    ORDER BY c.created_at, c.id
  `).all(postId).map((comment) => commentRow(comment, viewerId));
  return { ...postRow(row, viewerId), comments };
}

export function createPost(user, input) {
  const category = String(input?.category || "free").trim().toLowerCase();
  const board = activeBoard(category);
  if (roleLevel(user.role) < board.writeLevel) throw new CommunityError(403, "BOARD_WRITE_FORBIDDEN", "이 게시판에 글을 작성할 권한이 없습니다.");
  const isSecret = input?.isSecret === true;
  if (isSecret && !board.allowSecret) throw new CommunityError(400, "SECRET_NOT_ALLOWED", "이 게시판은 비밀글을 허용하지 않습니다.");
  const title = requiredText(input?.title, "제목", 2, 80);
  const content = requiredText(input?.content, "내용", 2, 5000);
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO community_posts (author_id, category, title, content, is_secret, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, category, title, content, isSecret ? 1 : 0, now, now);
  return getPost(Number(result.lastInsertRowid), { viewerId: user.id, viewerRole: user.role, incrementView: false });
}

export function updatePost(user, postId, input) {
  const row = db.prepare("SELECT author_id, category, deleted_at FROM community_posts WHERE id = ?").get(postId);
  if (!row || row.deleted_at) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  const board = activeBoard(row.category);
  if (Number(row.author_id) !== Number(user.id) && !(board.managersEditAll && roleLevel(user.role) >= 2)) throw new CommunityError(403, "FORBIDDEN", "본인이 작성한 게시글만 수정할 수 있습니다.");
  const title = requiredText(input?.title, "제목", 2, 80);
  const content = requiredText(input?.content, "내용", 2, 5000);
  db.prepare("UPDATE community_posts SET title=?, content=?, updated_at=? WHERE id=?").run(title, content, new Date().toISOString(), postId);
  return getPost(postId, { viewerId: user.id, viewerRole: user.role, incrementView: false });
}

const POST_PURGE_DAYS = 30;

export function deletePost(user, postId) {
  const row = db.prepare("SELECT author_id, category, deleted_at FROM community_posts WHERE id = ?").get(postId);
  if (!row) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  if (row.deleted_at) throw new CommunityError(409, "POST_ALREADY_DELETED", "이미 삭제 대기 중인 게시글입니다.");
  const board = activeBoard(row.category);
  if (Number(row.author_id) !== Number(user.id) && !(board.managersEditAll && roleLevel(user.role) >= 2)) throw new CommunityError(403, "FORBIDDEN", "본인이 작성한 게시글만 삭제할 수 있습니다.");
  const now = new Date();
  const purgeAt = new Date(now.getTime() + POST_PURGE_DAYS * 24 * 60 * 60 * 1000);
  db.prepare("UPDATE community_posts SET deleted_at=?, purge_at=? WHERE id=?").run(now.toISOString(), purgeAt.toISOString(), postId);
}

export function purgeExpiredPosts(now = new Date()) {
  const expired = db.prepare("SELECT id FROM community_posts WHERE purge_at IS NOT NULL AND purge_at <= ?").all(now.toISOString());
  if (!expired.length) return 0;
  transaction(() => {
    for (const row of expired) {
      db.prepare("DELETE FROM notifications WHERE post_id = ?").run(row.id);
      db.prepare("DELETE FROM community_posts WHERE id = ?").run(row.id);
    }
  });
  return expired.length;
}

export function createComment(user, postId, input) {
  const content = requiredText(input?.content, "댓글", 1, 1000);
  const post = db.prepare("SELECT author_id, category, is_secret, title, deleted_at FROM community_posts WHERE id = ?").get(postId);
  if (!post || post.deleted_at) {
    throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  }
  const board = activeBoard(post.category);
  const level = roleLevel(user.role);
  if (level < board.readLevel) throw new CommunityError(403, "BOARD_READ_FORBIDDEN", "이 게시판을 열람할 권한이 없습니다.");
  if (!board.commentsEnabled) throw new CommunityError(403, "COMMENTS_DISABLED", "이 게시판은 댓글 작성을 허용하지 않습니다.");
  if (level < board.commentLevel) throw new CommunityError(403, "BOARD_COMMENT_FORBIDDEN", "이 게시판에 댓글을 작성할 권한이 없습니다.");
  if (board.visibilityMode === "author_admin" && level < 2 && Number(post.author_id) !== Number(user.id)) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  if (post.is_secret && level < board.secretReadLevel && Number(post.author_id) !== Number(user.id)) throw new CommunityError(404, "POST_NOT_FOUND", "게시글을 찾을 수 없습니다.");
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO community_comments (post_id, author_id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(postId, user.id, content, now, now);
  const row = db.prepare(`
    SELECT c.*, u.nickname AS author_nickname, u.game_nickname AS author_game_nickname, u.game_nickname_public AS author_game_nickname_public
    FROM community_comments c JOIN community_users u ON u.id = c.author_id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);
  if (Number(post.author_id) !== Number(user.id)) {
    createNotification({
      userId: post.author_id,
      type: "comment",
      postId,
      commentId: Number(result.lastInsertRowid),
      category: post.category,
      postTitle: post.title,
      actorNickname: user.nickname,
      preview: content.length > 80 ? `${content.slice(0, 80)}…` : content,
    });
  }
  return commentRow(row, user.id);
}

export function deleteComment(userId, commentId) {
  const row = db.prepare("SELECT c.author_id, p.category FROM community_comments c JOIN community_posts p ON p.id = c.post_id WHERE c.id = ?").get(commentId);
  if (!row) throw new CommunityError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  activeBoard(row.category);
  if (Number(row.author_id) !== Number(userId)) throw new CommunityError(403, "FORBIDDEN", "본인이 작성한 댓글만 삭제할 수 있습니다.");
  db.prepare("DELETE FROM community_comments WHERE id = ?").run(commentId);
}

export function updateComment(userId, commentId, input) {
  const row = db.prepare("SELECT c.author_id, p.category FROM community_comments c JOIN community_posts p ON p.id = c.post_id WHERE c.id = ?").get(commentId);
  if (!row) throw new CommunityError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  activeBoard(row.category);
  if (Number(row.author_id) !== Number(userId)) throw new CommunityError(403, "FORBIDDEN", "본인이 작성한 댓글만 수정할 수 있습니다.");
  const content = requiredText(input?.content, "댓글", 1, 1000);
  db.prepare("UPDATE community_comments SET content=?, updated_at=? WHERE id=?").run(content, new Date().toISOString(), commentId);
  const updated = db.prepare(`SELECT c.*, u.nickname AS author_nickname, u.game_nickname AS author_game_nickname, u.game_nickname_public AS author_game_nickname_public FROM community_comments c JOIN community_users u ON u.id=c.author_id WHERE c.id=?`).get(commentId);
  return commentRow(updated, userId);
}
