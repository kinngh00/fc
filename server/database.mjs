import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA synchronous = NORMAL");

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_time TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('building', 'active', 'retained', 'failed')),
      stage TEXT NOT NULL DEFAULT 'starting',
      ranking_count INTEGER NOT NULL DEFAULT 0,
      lineup_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS rankers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nexon_sn TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      ouid TEXT UNIQUE,
      ouid_resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ranking_entries (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      ranker_id INTEGER NOT NULL REFERENCES rankers(id),
      rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 10000),
      level INTEGER,
      level_gauge REAL,
      club_value INTEGER,
      elo REAL,
      win_rate REAL,
      wins INTEGER,
      draws INTEGER,
      losses INTEGER,
      team_colors_json TEXT NOT NULL DEFAULT '[]',
      primary_team_color TEXT,
      team_color_count INTEGER,
      formation TEXT,
      current_grade TEXT,
      best_grade TEXT,
      previous_grade TEXT,
      lineup_status TEXT NOT NULL DEFAULT 'PENDING',
      match_id TEXT,
      PRIMARY KEY (snapshot_id, ranker_id),
      UNIQUE (snapshot_id, rank)
    );

    CREATE TABLE IF NOT EXISTS lineup_players (
      snapshot_id INTEGER NOT NULL,
      ranker_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      spid INTEGER NOT NULL,
      pid INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      position_id INTEGER NOT NULL CHECK (position_id BETWEEN 0 AND 27),
      grade INTEGER NOT NULL,
      rating REAL,
      goals INTEGER,
      assists INTEGER,
      PRIMARY KEY (snapshot_id, ranker_id, slot),
      FOREIGN KEY (snapshot_id, ranker_id)
        REFERENCES ranking_entries(snapshot_id, ranker_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_metadata (
      spid INTEGER PRIMARY KEY,
      pid INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      season_name TEXT,
      season_image TEXT,
      image_url TEXT,
      image_checked_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS position_metadata (
      position_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_color_assets (
      name TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ranking_history (
      ranker_id INTEGER NOT NULL REFERENCES rankers(id),
      data_time TEXT NOT NULL,
      rank INTEGER NOT NULL,
      club_value INTEGER,
      win_rate REAL,
      PRIMARY KEY (ranker_id, data_time)
    );

    CREATE TABLE IF NOT EXISTS squad_profile_cache (
      snapshot_id INTEGER NOT NULL,
      ranker_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, ranker_id),
      FOREIGN KEY (snapshot_id, ranker_id)
        REFERENCES ranking_entries(snapshot_id, ranker_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backend_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('정보', '경고', '오류', '성공')),
      component TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS community_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      game_nickname TEXT,
      game_nickname_public INTEGER NOT NULL DEFAULT 0,
      security_question TEXT,
      security_answer_hash TEXT,
      security_answer_salt TEXT,
      recovery_failures INTEGER NOT NULL DEFAULT 0,
      recovery_locked_until TEXT,
      google_sub TEXT UNIQUE,
      profile_complete INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'super_admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_user_consents (
      user_id INTEGER PRIMARY KEY REFERENCES community_users(id) ON DELETE CASCADE,
      terms_version TEXT NOT NULL,
      privacy_version TEXT NOT NULL,
      agreed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES community_users(id),
      category TEXT NOT NULL DEFAULT 'free',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES community_users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_post_views (
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,
      viewed_at TEXT NOT NULL,
      PRIMARY KEY (post_id, viewer_key)
    );

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      visitor_id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      user_id INTEGER REFERENCES community_users(id) ON DELETE SET NULL,
      current_path TEXT,
      referrer TEXT,
      user_agent TEXT,
      browser TEXT,
      os TEXT,
      device_type TEXT,
      language TEXT,
      timezone TEXT,
      screen_width INTEGER,
      screen_height INTEGER,
      viewport_width INTEGER,
      viewport_height INTEGER,
      page_view_count INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS visitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL REFERENCES visitor_sessions(visitor_id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES community_users(id) ON DELETE SET NULL,
      ip_address TEXT NOT NULL,
      event_type TEXT NOT NULL,
      path TEXT,
      page_title TEXT,
      target TEXT,
      search_type TEXT,
      details_json TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitor_lifetime_stats (
      identity_type TEXT NOT NULL CHECK (identity_type IN ('ip', 'user')),
      identity_value TEXT NOT NULL,
      user_id INTEGER REFERENCES community_users(id) ON DELETE SET NULL,
      last_ip_address TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_visit_at TEXT NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (identity_type, identity_value)
    );

    CREATE TABLE IF NOT EXISTS access_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restriction_type TEXT NOT NULL DEFAULT 'block' CHECK (restriction_type IN ('block', 'suspend')),
      target_type TEXT NOT NULL CHECK (target_type IN ('ip', 'user')),
      target_value TEXT NOT NULL,
      user_id INTEGER REFERENCES community_users(id) ON DELETE SET NULL,
      reason_code TEXT NOT NULL,
      reason_text TEXT,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      permanent INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL REFERENCES community_users(id),
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by INTEGER REFERENCES community_users(id)
    );

    CREATE TABLE IF NOT EXISTS content_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
      target_id INTEGER NOT NULL,
      reporter_user_id INTEGER REFERENCES community_users(id) ON DELETE SET NULL,
      reporter_ip TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      reason_text TEXT,
      page_url TEXT NOT NULL,
      author_id INTEGER,
      author_nickname TEXT NOT NULL,
      content_title TEXT,
      content_body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected')),
      admin_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('comment')),
      post_id INTEGER NOT NULL,
      comment_id INTEGER,
      category TEXT NOT NULL,
      post_title TEXT NOT NULL,
      actor_nickname TEXT NOT NULL,
      preview TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_boards (
      slug TEXT PRIMARY KEY COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      show_in_navigation INTEGER NOT NULL DEFAULT 1,
      read_level INTEGER NOT NULL DEFAULT 0 CHECK (read_level BETWEEN 0 AND 3),
      write_level INTEGER NOT NULL DEFAULT 1 CHECK (write_level BETWEEN 0 AND 3),
      comment_level INTEGER NOT NULL DEFAULT 1 CHECK (comment_level BETWEEN 0 AND 3),
      comments_enabled INTEGER NOT NULL DEFAULT 1,
      allow_secret INTEGER NOT NULL DEFAULT 0,
      secret_read_level INTEGER NOT NULL DEFAULT 2 CHECK (secret_read_level BETWEEN 0 AND 3),
      visibility_mode TEXT NOT NULL DEFAULT 'public' CHECK (visibility_mode IN ('public', 'author_admin')),
      managers_edit_all INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      purge_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ranking_entries_filter_idx
      ON ranking_entries(snapshot_id, rank, primary_team_color);
    CREATE INDEX IF NOT EXISTS lineup_players_pick_idx
      ON lineup_players(snapshot_id, position_id, spid, grade);
    CREATE INDEX IF NOT EXISTS ranking_history_time_idx
      ON ranking_history(data_time);
    CREATE INDEX IF NOT EXISTS ranking_history_ranker_idx
      ON ranking_history(ranker_id, data_time);
    CREATE INDEX IF NOT EXISTS backend_logs_created_idx
      ON backend_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS community_sessions_expiry_idx
      ON community_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS community_posts_created_idx
      ON community_posts(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS community_boards_order_idx
      ON community_boards(deleted_at, sort_order, slug);
    CREATE INDEX IF NOT EXISTS community_comments_post_idx
      ON community_comments(post_id, created_at, id);
    CREATE INDEX IF NOT EXISTS visitor_sessions_last_seen_idx
      ON visitor_sessions(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS visitor_sessions_ip_idx
      ON visitor_sessions(ip_address, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS visitor_events_time_idx
      ON visitor_events(occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS visitor_events_visitor_idx
      ON visitor_events(visitor_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS visitor_events_ip_idx
      ON visitor_events(ip_address, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS visitor_lifetime_visits_idx
      ON visitor_lifetime_stats(identity_type, visit_count DESC, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS access_bans_lookup_idx
      ON access_bans(target_type, target_value, active, ends_at);
    CREATE INDEX IF NOT EXISTS content_reports_status_idx
      ON content_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS notifications_user_idx
      ON notifications(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
      ON notifications(user_id, is_read, created_at DESC);
  `);

  const playerMetadataColumns = new Set(
    db.prepare("PRAGMA table_info(player_metadata)").all().map((column) => column.name),
  );
  if (!playerMetadataColumns.has("image_url")) {
    db.exec("ALTER TABLE player_metadata ADD COLUMN image_url TEXT");
  }
  if (!playerMetadataColumns.has("image_checked_at")) {
    db.exec("ALTER TABLE player_metadata ADD COLUMN image_checked_at TEXT");
  }
  const communityUserColumns = new Set(
    db.prepare("PRAGMA table_info(community_users)").all().map((column) => column.name),
  );
  if (!communityUserColumns.has("is_admin")) {
    db.exec("ALTER TABLE community_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  if (!communityUserColumns.has("game_nickname")) db.exec("ALTER TABLE community_users ADD COLUMN game_nickname TEXT");
  if (!communityUserColumns.has("game_nickname_public")) db.exec("ALTER TABLE community_users ADD COLUMN game_nickname_public INTEGER NOT NULL DEFAULT 0");
  if (!communityUserColumns.has("security_question")) db.exec("ALTER TABLE community_users ADD COLUMN security_question TEXT");
  if (!communityUserColumns.has("security_answer_hash")) db.exec("ALTER TABLE community_users ADD COLUMN security_answer_hash TEXT");
  if (!communityUserColumns.has("security_answer_salt")) db.exec("ALTER TABLE community_users ADD COLUMN security_answer_salt TEXT");
  if (!communityUserColumns.has("recovery_failures")) db.exec("ALTER TABLE community_users ADD COLUMN recovery_failures INTEGER NOT NULL DEFAULT 0");
  if (!communityUserColumns.has("recovery_locked_until")) db.exec("ALTER TABLE community_users ADD COLUMN recovery_locked_until TEXT");
  if (!communityUserColumns.has("google_sub")) db.exec("ALTER TABLE community_users ADD COLUMN google_sub TEXT");
  if (!communityUserColumns.has("profile_complete")) db.exec("ALTER TABLE community_users ADD COLUMN profile_complete INTEGER NOT NULL DEFAULT 1");
  if (!communityUserColumns.has("nickname_changed_at")) db.exec("ALTER TABLE community_users ADD COLUMN nickname_changed_at TEXT");
  if (!communityUserColumns.has("withdrawn_at")) db.exec("ALTER TABLE community_users ADD COLUMN withdrawn_at TEXT");
  if (!communityUserColumns.has("role")) {
    db.exec("ALTER TABLE community_users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
    db.exec("UPDATE community_users SET role = CASE WHEN is_admin = 1 AND nickname = 'FC-SUPPORT' THEN 'super_admin' WHEN is_admin = 1 THEN 'admin' ELSE 'member' END");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS community_users_google_sub_idx ON community_users(google_sub) WHERE google_sub IS NOT NULL");
  const communityPostColumns = new Set(
    db.prepare("PRAGMA table_info(community_posts)").all().map((column) => column.name),
  );
  if (!communityPostColumns.has("category")) {
    db.exec("ALTER TABLE community_posts ADD COLUMN category TEXT NOT NULL DEFAULT 'free'");
  }
  if (!communityPostColumns.has("is_secret")) db.exec("ALTER TABLE community_posts ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0");
  if (!communityPostColumns.has("deleted_at")) db.exec("ALTER TABLE community_posts ADD COLUMN deleted_at TEXT");
  if (!communityPostColumns.has("purge_at")) db.exec("ALTER TABLE community_posts ADD COLUMN purge_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS community_posts_category_created_idx ON community_posts(category, created_at DESC, id DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS community_posts_purge_idx ON community_posts(purge_at)");
  const boardNow = new Date().toISOString();
  const insertBoard = db.prepare(`
    INSERT INTO community_boards
      (slug, name, description, sort_order, show_in_navigation, read_level, write_level, comment_level, comments_enabled, allow_secret, secret_read_level, visibility_mode, managers_edit_all, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO NOTHING
  `);
  for (const board of [
    ["notice", "공지", "운영 공지사항", 10, 1, 0, 2, 3, 0, 0, 2, "public", 1],
    ["free", "자유게시판", "자유롭게 이야기를 나누는 게시판", 20, 1, 0, 1, 1, 1, 0, 2, "public", 0],
    ["tip", "팁", "감독모드 팁과 정보를 공유하는 게시판", 30, 1, 0, 1, 1, 1, 0, 2, "public", 0],
    ["question", "질문", "질문과 답변을 나누는 게시판", 40, 1, 0, 1, 1, 1, 1, 2, "public", 0],
    ["inquiry", "문의·건의", "작성자와 관리자만 확인하는 문의 게시판", 50, 0, 1, 1, 1, 1, 0, 2, "author_admin", 1],
  ]) insertBoard.run(...board, boardNow, boardNow);
  const accessBanColumns = new Set(
    db.prepare("PRAGMA table_info(access_bans)").all().map((column) => column.name),
  );
  if (!accessBanColumns.has("restriction_type")) {
    db.exec("ALTER TABLE access_bans ADD COLUMN restriction_type TEXT NOT NULL DEFAULT 'block'");
  }
}

export function transaction(callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getActiveSnapshot() {
  return db.prepare(`
    SELECT s.*
    FROM snapshots s
    JOIN app_state a ON a.key = 'active_snapshot_id' AND a.value = CAST(s.id AS TEXT)
    WHERE s.status = 'active'
  `).get() || null;
}

export function createSnapshot(dataTime) {
  const result = db.prepare(`
    INSERT INTO snapshots (data_time, started_at, status, stage)
    VALUES (?, ?, 'building', 'ranking')
  `).run(dataTime, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function updateSnapshot(id, fields) {
  const allowed = ["stage", "ranking_count", "lineup_count", "failure_count", "error_message"];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return;
  const set = entries.map(([key]) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE snapshots SET ${set} WHERE id = ?`).run(...entries.map(([, value]) => value), id);
}

export function failSnapshot(id, error) {
  db.prepare(`
    UPDATE snapshots
    SET status = 'failed', stage = 'failed', completed_at = ?, error_message = ?
    WHERE id = ?
  `).run(new Date().toISOString(), String(error?.message || error).slice(0, 2000), id);
}

export function failAbandonedSnapshots() {
  const result = db.prepare(`
    UPDATE snapshots
    SET status = 'failed', stage = 'failed', completed_at = ?,
        error_message = 'Backend stopped before collection completed.'
    WHERE status = 'building'
  `).run(new Date().toISOString());
  return Number(result.changes);
}

export function acquireCollectionLock(owner) {
  return transaction(() => {
    const current = db.prepare("SELECT value FROM app_state WHERE key = 'collection_lock'").get();
    if (current) {
      try {
        const lock = JSON.parse(current.value);
        const age = Date.now() - Number(lock.acquiredAt || 0);
        let processAlive = false;
        if (Number.isInteger(lock.pid) && lock.pid > 0) {
          try {
            process.kill(lock.pid, 0);
            processAlive = true;
          } catch {}
        }
        if (processAlive && age < 6 * 60 * 60 * 1000) return false;
      } catch {}
      db.prepare("DELETE FROM app_state WHERE key = 'collection_lock'").run();
    }
    db.prepare("INSERT INTO app_state (key, value) VALUES ('collection_lock', ?)").run(JSON.stringify({
      owner,
      pid: process.pid,
      acquiredAt: Date.now(),
    }));
    return true;
  });
}

export function releaseCollectionLock(owner) {
  const current = db.prepare("SELECT value FROM app_state WHERE key = 'collection_lock'").get();
  if (!current) return;
  try {
    if (JSON.parse(current.value).owner !== owner) return;
  } catch {
    return;
  }
  db.prepare("DELETE FROM app_state WHERE key = 'collection_lock'").run();
}

export function promoteSnapshot(id) {
  transaction(() => {
    const candidate = db.prepare("SELECT status FROM snapshots WHERE id = ?").get(id);
    if (!candidate || candidate.status !== "building") {
      throw new Error(`Snapshot ${id} is not eligible for promotion.`);
    }
    const current = getActiveSnapshot();
    const promoted = db.prepare(`
      UPDATE snapshots
      SET status = 'active', stage = 'complete', completed_at = ?
      WHERE id = ? AND status = 'building'
    `).run(new Date().toISOString(), id);
    if (Number(promoted.changes) !== 1) throw new Error(`Snapshot ${id} promotion failed.`);

    if (current) {
      db.prepare("UPDATE snapshots SET status = 'retained' WHERE id = ?").run(current.id);
    }

    db.prepare(`
      INSERT INTO app_state (key, value) VALUES ('active_snapshot_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(id));

    db.prepare(`
      INSERT OR REPLACE INTO ranking_history (ranker_id, data_time, rank, club_value, win_rate)
      SELECT e.ranker_id, s.data_time, e.rank, e.club_value, e.win_rate
      FROM ranking_entries e
      JOIN snapshots s ON s.id = e.snapshot_id
      WHERE e.snapshot_id = ?
    `).run(id);

    db.prepare("DELETE FROM ranking_history WHERE datetime(data_time) < datetime('now', '-30 days')").run();

    const retained = db.prepare(`
      SELECT id FROM snapshots
      WHERE status = 'retained'
      ORDER BY completed_at DESC, id DESC
    `).all();
    for (const old of retained.slice(1)) {
      db.prepare("DELETE FROM snapshots WHERE id = ?").run(old.id);
    }
    db.prepare("DELETE FROM snapshots WHERE status = 'failed' AND started_at < datetime('now', '-24 hours')").run();
  });
}

initializeDatabase();
