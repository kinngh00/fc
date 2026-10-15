import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`backend exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend did not start in time");
}

async function call(baseUrl, pathname, { method = "GET", cookie = "", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] || "" };
}

function registrationBody(input) {
  return {
    termsAccepted: true,
    privacyAccepted: true,
    gameNickname: "테스트구단",
    securityQuestion: "어린 시절 가장 기억에 남는 장소는 어디인가요?",
    securityAnswer: "테스트답변",
    ...input,
  };
}

test("community auth, public reads, member writes and owner deletes", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "fc-support-community-"));
  const port = 19000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const testEnv = {
    ...process.env,
    FC_DB_PATH: path.join(directory, "community.db"),
    FC_SCHEDULER_ENABLED: "false",
    FC_COLLECT_ON_EMPTY: "false",
    FC_COLLECT_ON_STALE: "false",
    FC_RECOVER_ABANDONED_SNAPSHOTS: "false",
  };
  const adminSetup = spawnSync(process.execPath, ["scripts/create-admin.mjs"], { cwd: root, env: { ...testEnv, FC_CREATE_ADMIN_LOGIN_ID: "admin_01", FC_CREATE_ADMIN_PASSWORD: "secure-admin-01" } });
  assert.equal(adminSetup.status, 0);
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...testEnv,
      FC_BACKEND_PORT: String(port),
      FC_DB_PATH: path.join(directory, "community.db"),
      FC_SCHEDULER_ENABLED: "false",
      FC_COLLECT_ON_EMPTY: "false",
      FC_COLLECT_ON_STALE: "false",
      FC_RECOVER_ABANDONED_SNAPSHOTS: "false",
      FC_FRONTEND_ORIGIN: "http://localhost:3000",
      FC_ADMIN_TOKEN: "test-admin-token",
    },
    stdio: "ignore",
  });
  context.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode == null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child);

  const empty = await call(baseUrl, "/api/community/posts");
  assert.equal(empty.response.status, 200);
  assert.equal(empty.payload.total, 0);
  assert.deepEqual(empty.payload.items, []);

  const protectedLogs = await call(baseUrl, "/api/logs");
  assert.equal(protectedLogs.response.status, 401);
  const authorizedLogs = await call(baseUrl, "/api/logs", { headers: { authorization: "Bearer test-admin-token" } });
  assert.equal(authorizedLogs.response.status, 200);
  const rejectedOrigin = await call(baseUrl, "/api/auth/register", {
    method: "POST",
    headers: { origin: "https://untrusted.example" },
    body: registrationBody({ loginId: "blocked_01", nickname: "차단회원", password: "secure-pass-00" }),
  });
  assert.equal(rejectedOrigin.response.status, 403);

  const anonymousCreate = await call(baseUrl, "/api/community/posts", { method: "POST", body: { title: "테스트", content: "내용입니다." } });
  assert.equal(anonymousCreate.response.status, 401);

  const registration = await call(baseUrl, "/api/auth/register", { method: "POST", headers: { "x-forwarded-proto": "https" }, body: registrationBody({ loginId: "owner_01", nickname: "작성자", password: "secure-pass-01" }) });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.cookie.startsWith("fc_support_session="));
  assert.match(registration.response.headers.get("set-cookie"), /; Secure/);
  for (const nickname of ["밑줄_금지", "공백 금지", "기호!금지"]) {
    const invalidNickname = await call(baseUrl, "/api/auth/register", { method: "POST", body: registrationBody({ loginId: `bad${nickname.length}${nickname.charCodeAt(0)}`, nickname, password: "secure-pass-03" }) });
    assert.equal(invalidNickname.response.status, 400);
    assert.equal(invalidNickname.payload.code, "INVALID_NICKNAME");
  }

  const me = await call(baseUrl, "/api/auth/me", { cookie: registration.cookie });
  assert.equal(me.payload.user.nickname, "작성자");

  const duplicateRegistration = await call(baseUrl, "/api/auth/register", { method: "POST", body: registrationBody({ loginId: "owner_01", nickname: "중복회원", password: "secure-pass-01" }) });
  assert.equal(duplicateRegistration.response.status, 409);
  const invalidLogin = await call(baseUrl, "/api/auth/login", { method: "POST", body: { loginId: "owner_01", password: "wrong-password" } });
  assert.equal(invalidLogin.response.status, 401);
  const logout = await call(baseUrl, "/api/auth/logout", { method: "POST", cookie: registration.cookie, body: {} });
  assert.equal(logout.response.status, 200);
  const loggedOutMe = await call(baseUrl, "/api/auth/me", { cookie: registration.cookie });
  assert.equal(loggedOutMe.payload.user, null);
  const login = await call(baseUrl, "/api/auth/login", { method: "POST", headers: { "x-forwarded-proto": "https" }, body: { loginId: "owner_01", password: "secure-pass-01" } });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.user.nickname, "작성자");
  assert.match(login.response.headers.get("set-cookie"), /; Secure/);
  const ownerCookie = login.cookie;

  const forbiddenNotice = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: ownerCookie, body: { category: "notice", title: "일반 공지", content: "작성 금지" } });
  assert.equal(forbiddenNotice.response.status, 403);
  const adminLogin = await call(baseUrl, "/api/auth/login", { method: "POST", body: { loginId: "admin_01", password: "secure-admin-01" } });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.payload.user.nickname, "FC-SUPPORT");
  const notice = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: adminLogin.cookie, body: { category: "notice", title: "운영 공지", content: "모두 읽을 수 있습니다." } });
  assert.equal(notice.response.status, 201);
  assert.equal(notice.payload.category, "notice");
  const noticeRead = await call(baseUrl, `/api/community/posts/${notice.payload.id}`);
  assert.equal(noticeRead.response.status, 200);
  const noticeComment = await call(baseUrl, `/api/community/posts/${notice.payload.id}/comments`, { method: "POST", cookie: ownerCookie, body: { content: "댓글 금지" } });
  assert.equal(noticeComment.response.status, 403);

  const creation = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: ownerCookie, body: { title: "실제 게시글", content: "DB에 저장되는 실제 내용입니다." } });
  assert.equal(creation.response.status, 201);
  assert.equal(creation.payload.canDelete, true);

  const publicList = await call(baseUrl, "/api/community/posts");
  assert.equal(publicList.payload.total, 1);
  assert.equal(publicList.payload.items[0].title, "실제 게시글");
  assert.equal(publicList.payload.items[0].canDelete, false);

  const publicDetail = await call(baseUrl, `/api/community/posts/${creation.payload.id}`);
  assert.equal(publicDetail.response.status, 200);
  assert.equal(publicDetail.payload.content, "DB에 저장되는 실제 내용입니다.");
  assert.equal(publicDetail.payload.viewCount, 1);
  const repeatedDetail = await call(baseUrl, `/api/community/posts/${creation.payload.id}`);
  assert.equal(repeatedDetail.payload.viewCount, 1);
  const otherVisitorDetail = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { headers: { "x-fc-visitor-id": "visitor_abcdefgh" } });
  assert.equal(otherVisitorDetail.payload.viewCount, 2);
  const repeatedOtherVisitorDetail = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { headers: { "x-fc-visitor-id": "visitor_abcdefgh" } });
  assert.equal(repeatedOtherVisitorDetail.payload.viewCount, 2);

  const comment = await call(baseUrl, `/api/community/posts/${creation.payload.id}/comments`, { method: "POST", cookie: ownerCookie, body: { content: "첫 댓글" } });
  assert.equal(comment.response.status, 201);
  assert.equal(comment.payload.canDelete, true);
  const editPost = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { method: "PATCH", cookie: ownerCookie, body: { title: "수정 게시글", content: "수정된 내용입니다." } });
  assert.equal(editPost.response.status, 200);
  assert.equal(editPost.payload.title, "수정 게시글");
  const editComment = await call(baseUrl, `/api/community/comments/${comment.payload.id}`, { method: "PATCH", cookie: ownerCookie, body: { content: "수정 댓글" } });
  assert.equal(editComment.response.status, 200);

  const secondRegistration = await call(baseUrl, "/api/auth/register", { method: "POST", body: registrationBody({ loginId: "reader_02", nickname: "다른회원", password: "secure-pass-02" }) });
  assert.equal(secondRegistration.response.status, 201);
  const forbiddenPostDelete = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { method: "DELETE", cookie: secondRegistration.cookie });
  assert.equal(forbiddenPostDelete.response.status, 403);
  const forbiddenCommentDelete = await call(baseUrl, `/api/community/comments/${comment.payload.id}`, { method: "DELETE", cookie: secondRegistration.cookie });
  assert.equal(forbiddenCommentDelete.response.status, 403);
  const forbiddenPostEdit = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { method: "PATCH", cookie: secondRegistration.cookie, body: { title: "가로채기", content: "금지" } });
  assert.equal(forbiddenPostEdit.response.status, 403);

  const tip = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: secondRegistration.cookie, body: { category: "tip", title: "전술 검색 팁", content: "감독모드 내용 검색" } });
  assert.equal(tip.response.status, 201);
  const tipSearch = await call(baseUrl, "/api/community/posts?category=tip&searchMode=author&q=다른회원");
  assert.equal(tipSearch.payload.total, 1);
  assert.equal(tipSearch.payload.items[0].id, tip.payload.id);
  const freeSearch = await call(baseUrl, "/api/community/posts?category=free&searchMode=title&q=수정");
  assert.equal(freeSearch.payload.total, 1);

  const percentPost = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: ownerCookie, body: { title: "50% 할인 정보", content: "이벤트" } });
  assert.equal(percentPost.response.status, 201);
  const percentDecoyPost = await call(baseUrl, "/api/community/posts", { method: "POST", cookie: ownerCookie, body: { title: "50가지 정보", content: "이벤트" } });
  assert.equal(percentDecoyPost.response.status, 201);
  const percentSearch = await call(baseUrl, `/api/community/posts?category=free&searchMode=title&q=${encodeURIComponent("50%")}`);
  assert.equal(percentSearch.payload.total, 1);
  assert.equal(percentSearch.payload.items[0].id, percentPost.payload.id);
  await call(baseUrl, `/api/community/posts/${percentPost.payload.id}`, { method: "DELETE", cookie: ownerCookie });
  await call(baseUrl, `/api/community/posts/${percentDecoyPost.payload.id}`, { method: "DELETE", cookie: ownerCookie });

  const commentDelete = await call(baseUrl, `/api/community/comments/${comment.payload.id}`, { method: "DELETE", cookie: ownerCookie });
  assert.equal(commentDelete.response.status, 200);
  const postDelete = await call(baseUrl, `/api/community/posts/${creation.payload.id}`, { method: "DELETE", cookie: ownerCookie });
  assert.equal(postDelete.response.status, 200);

  const finalList = await call(baseUrl, "/api/community/posts");
  assert.equal(finalList.payload.total, 0);
});
