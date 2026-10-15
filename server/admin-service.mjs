import { db, getActiveSnapshot, transaction } from "./database.mjs";
import { CommunityError } from "./community-service.mjs";
import { listLogs } from "./logger.mjs";
import { recentSnapshots } from "./queries.mjs";

export function adminDashboard() {
  const counts = {
    users: Number(db.prepare("SELECT COUNT(*) AS count FROM community_users").get().count),
    admins: Number(db.prepare("SELECT COUNT(*) AS count FROM community_users WHERE role IN ('admin','super_admin')").get().count),
    posts: Number(db.prepare("SELECT COUNT(*) AS count FROM community_posts").get().count),
    comments: Number(db.prepare("SELECT COUNT(*) AS count FROM community_comments").get().count),
    pendingReports: Number(db.prepare("SELECT COUNT(*) AS count FROM content_reports WHERE status IN ('pending','reviewing')").get().count),
    activeRestrictions: Number(db.prepare("SELECT COUNT(*) AS count FROM access_bans WHERE revoked_at IS NULL AND (permanent=1 OR ends_at > ?)").get(new Date().toISOString()).count),
    inquiries: Number(db.prepare("SELECT COUNT(*) AS count FROM community_posts WHERE category='inquiry'").get().count),
  };
  const users = db.prepare(`
    SELECT id, login_id AS loginId, nickname, is_admin AS isAdmin, role, created_at AS createdAt
    FROM community_users ORDER BY created_at DESC LIMIT 500
  `).all().map((row) => ({ ...row, id: Number(row.id), isAdmin: Boolean(row.isAdmin) }));
  const inquiries = db.prepare(`
    SELECT p.id, p.title, p.content, p.created_at AS createdAt, u.nickname AS authorNickname, u.login_id AS authorLoginId
    FROM community_posts p JOIN community_users u ON u.id = p.author_id
    WHERE p.category = 'inquiry' ORDER BY p.created_at DESC LIMIT 100
  `).all().map((row) => ({
    id: Number(row.id),
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    authorNickname: row.authorNickname,
    authorLoginId: row.authorLoginId,
    replies: db.prepare(`
      SELECT c.content, c.created_at AS createdAt, u.nickname AS authorNickname, u.is_admin AS isAdmin
      FROM community_comments c JOIN community_users u ON u.id = c.author_id
      WHERE c.post_id = ? ORDER BY c.created_at
    `).all(row.id).map((reply) => ({ content: reply.content, createdAt: reply.createdAt, authorNickname: reply.authorNickname, isAdmin: Boolean(reply.isAdmin) })),
  }));
  return { generatedAt: new Date().toISOString(), activeSnapshot: getActiveSnapshot(), counts, snapshots: recentSnapshots(10), logs: listLogs(300, 0), users, inquiries };
}

function requireSuperAdmin(user) {
  if (user?.role !== "super_admin") throw new CommunityError(403, "SUPER_ADMIN_REQUIRED", "최고 관리자만 게시판 설정을 변경할 수 있습니다.");
}

function text(value, name, min, max) {
  const result = String(value || "").trim();
  if (result.length < min || result.length > max) throw new CommunityError(400, "INVALID_BOARD", `${name}은(는) ${min}~${max}자로 입력해 주세요.`);
  return result;
}

function level(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 3) throw new CommunityError(400, "INVALID_BOARD", `${name} 권한이 올바르지 않습니다.`);
  return result;
}

function boardPayload(input, { creating = false } = {}) {
  const slug = text(input?.slug, "게시판 식별자", 2, 30).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) throw new CommunityError(400, "INVALID_BOARD_SLUG", "게시판 식별자는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.");
  return {
    slug,
    name: text(input?.name, "게시판 이름", 1, 30),
    description: String(input?.description || "").trim().slice(0, 200),
    sortOrder: Number.isInteger(Number(input?.sortOrder)) ? Number(input.sortOrder) : creating ? 100 : 0,
    showInNavigation: input?.showInNavigation !== false,
    readLevel: level(input?.readLevel, "열람"),
    writeLevel: level(input?.writeLevel, "게시글 작성"),
    commentLevel: level(input?.commentLevel, "댓글 작성"),
    commentsEnabled: input?.commentsEnabled !== false,
    allowSecret: input?.allowSecret === true,
    secretReadLevel: level(input?.secretReadLevel ?? 2, "비밀글 열람"),
    visibilityMode: input?.visibilityMode === "author_admin" ? "author_admin" : "public",
    managersEditAll: input?.managersEditAll === true,
  };
}

function adminBoardRow(row) {
  return {
    slug: row.slug, name: row.name, description: row.description, sortOrder: Number(row.sort_order),
    showInNavigation: Boolean(row.show_in_navigation), readLevel: Number(row.read_level), writeLevel: Number(row.write_level),
    commentLevel: Number(row.comment_level), commentsEnabled: Boolean(row.comments_enabled), allowSecret: Boolean(row.allow_secret),
    secretReadLevel: Number(row.secret_read_level), visibilityMode: row.visibility_mode, managersEditAll: Boolean(row.managers_edit_all),
    deletedAt: row.deleted_at || null, purgeAt: row.purge_at || null, postCount: Number(row.post_count || 0),
  };
}

export function purgeExpiredBoards(now = new Date()) {
  const expired = db.prepare("SELECT slug FROM community_boards WHERE purge_at IS NOT NULL AND purge_at <= ?").all(now.toISOString());
  if (!expired.length) return 0;
  transaction(() => {
    for (const row of expired) {
      db.prepare("DELETE FROM community_posts WHERE category = ?").run(row.slug);
      db.prepare("DELETE FROM community_boards WHERE slug = ?").run(row.slug);
    }
  });
  return expired.length;
}

export function listAdminBoards(user) {
  requireSuperAdmin(user);
  purgeExpiredBoards();
  return db.prepare(`SELECT b.*, COUNT(p.id) AS post_count FROM community_boards b LEFT JOIN community_posts p ON p.category = b.slug GROUP BY b.slug ORDER BY b.deleted_at IS NOT NULL, b.sort_order, b.slug`).all().map(adminBoardRow);
}

export function createBoard(user, input) {
  requireSuperAdmin(user);
  const board = boardPayload(input, { creating: true });
  const now = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO community_boards (slug,name,description,sort_order,show_in_navigation,read_level,write_level,comment_level,comments_enabled,allow_secret,secret_read_level,visibility_mode,managers_edit_all,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(board.slug, board.name, board.description, board.sortOrder, board.showInNavigation ? 1 : 0, board.readLevel, board.writeLevel, board.commentLevel, board.commentsEnabled ? 1 : 0, board.allowSecret ? 1 : 0, board.secretReadLevel, board.visibilityMode, board.managersEditAll ? 1 : 0, now, now);
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE")) throw new CommunityError(409, "BOARD_EXISTS", "이미 사용 중인 게시판 식별자입니다.");
    throw error;
  }
  return listAdminBoards(user).find((item) => item.slug === board.slug);
}

export function updateBoard(user, currentSlug, input) {
  requireSuperAdmin(user);
  const existing = db.prepare("SELECT * FROM community_boards WHERE slug = ? COLLATE NOCASE AND deleted_at IS NULL").get(currentSlug);
  if (!existing) throw new CommunityError(404, "BOARD_NOT_FOUND", "게시판을 찾을 수 없습니다.");
  const board = boardPayload(input);
  const now = new Date().toISOString();
  try {
    transaction(() => {
      db.prepare(`UPDATE community_boards SET slug=?,name=?,description=?,sort_order=?,show_in_navigation=?,read_level=?,write_level=?,comment_level=?,comments_enabled=?,allow_secret=?,secret_read_level=?,visibility_mode=?,managers_edit_all=?,updated_at=? WHERE slug=?`)
        .run(board.slug, board.name, board.description, board.sortOrder, board.showInNavigation ? 1 : 0, board.readLevel, board.writeLevel, board.commentLevel, board.commentsEnabled ? 1 : 0, board.allowSecret ? 1 : 0, board.secretReadLevel, board.visibilityMode, board.managersEditAll ? 1 : 0, now, currentSlug);
      if (board.slug !== currentSlug) db.prepare("UPDATE community_posts SET category = ? WHERE category = ?").run(board.slug, currentSlug);
    });
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE")) throw new CommunityError(409, "BOARD_EXISTS", "이미 사용 중인 게시판 식별자입니다.");
    throw error;
  }
  return listAdminBoards(user).find((item) => item.slug === board.slug);
}

export function deleteBoard(user, slug) {
  requireSuperAdmin(user);
  const row = db.prepare("SELECT slug, deleted_at FROM community_boards WHERE slug = ? COLLATE NOCASE").get(slug);
  if (!row) throw new CommunityError(404, "BOARD_NOT_FOUND", "게시판을 찾을 수 없습니다.");
  if (row.deleted_at) throw new CommunityError(409, "BOARD_ALREADY_DELETED", "이미 삭제 대기 중인 게시판입니다.");
  const deletedAt = new Date();
  const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  db.prepare("UPDATE community_boards SET deleted_at=?, purge_at=?, updated_at=? WHERE slug=?").run(deletedAt.toISOString(), purgeAt.toISOString(), deletedAt.toISOString(), slug);
  return { ok: true, deletedAt: deletedAt.toISOString(), purgeAt: purgeAt.toISOString() };
}

export function restoreBoard(user, slug) {
  requireSuperAdmin(user);
  purgeExpiredBoards();
  const result = db.prepare("UPDATE community_boards SET deleted_at=NULL,purge_at=NULL,updated_at=? WHERE slug=? AND deleted_at IS NOT NULL").run(new Date().toISOString(), slug);
  if (!result.changes) throw new CommunityError(404, "BOARD_NOT_FOUND", "복구할 게시판을 찾을 수 없습니다.");
  return listAdminBoards(user).find((item) => item.slug === slug);
}

