"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { trackAnalytics } from "./analytics";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";
export const openCommunityAuthEvent = "fc-support:open-community-auth";
export const communityAuthChangedEvent = "fc-support:community-auth-changed";

type CommunityUser = { id: number; loginId: string; nickname: string; isAdmin: boolean; createdAt: string };
export function notifyCommunityAuth(user: CommunityUser | null) {
  window.dispatchEvent(new CustomEvent(communityAuthChangedEvent, { detail: user }));
}
type BoardCategory = "notice" | "free" | "tip";
type SearchMode = "title" | "title_content" | "content" | "author";
type CommunityComment = { id: number; content: string; createdAt: string; author: { id: number; nickname: string }; canEdit: boolean; canDelete: boolean };
type CommunityPost = {
  id: number;
  category: BoardCategory;
  title: string;
  content: string;
  excerpt: string;
  viewCount: number;
  commentCount: number;
  createdAt: string;
  author: { id: number; nickname: string };
  canEdit: boolean;
  canDelete: boolean;
  comments?: CommunityComment[];
};
type PostList = { total: number; items: CommunityPost[]; offset: number; limit: number; hasMore: boolean };
type RestrictionNotice = { nickname?: string | null; reasonCode: string; reasonText?: string; startsAt?: string; endsAt?: string; permanent: boolean };
class CommunityRequestError extends Error {
  code?: string;
  restriction?: RestrictionNotice;
  constructor(message: string, code?: string, restriction?: RestrictionNotice) { super(message); this.code = code; this.restriction = restriction; }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CommunityRequestError(payload.message || "요청을 처리하지 못했습니다.", payload.code, payload.restriction);
  return payload as T;
}

function communityDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function CommunitySection() {
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [posts, setPosts] = useState<PostList>({ total: 0, items: [], offset: 0, limit: 10, hasMore: false });
  const [selected, setSelected] = useState<CommunityPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [composerOpen, setComposerOpen] = useState(false);
  const [suspensionNotice, setSuspensionNotice] = useState<RestrictionNotice | null>(null);
  const [category, setCategory] = useState<BoardCategory>("free");
  const [searchMode, setSearchMode] = useState<SearchMode>("title_content");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadPosts = useCallback(async (offset = 0, nextQuery = searchQuery) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: "10", category, searchMode, q: nextQuery });
      const result = await request<PostList>(`/api/community/posts?${params}`);
      setPosts(result);
      if (selected) {
        const current = result.items.find((post) => post.id === selected.id);
        if (!current) setSelected(null);
      }
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setLoading(false);
    }
  }, [category, searchMode, searchQuery, selected]);

  useEffect(() => {
    void request<{ user: CommunityUser | null }>("/api/auth/me")
      .then((result) => { setUser(result.user); notifyCommunityAuth(result.user); })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => { void loadPosts(0, ""); }, [category]);

  useEffect(() => {
    const syncAuth = (event: Event) => {
      const nextUser = (event as CustomEvent<CommunityUser | null>).detail;
      setUser(nextUser);
      if (!nextUser) {
        setComposerOpen(false);
        setSelected((current) => current ? { ...current, canEdit: false, canDelete: false, comments: current.comments?.map((comment) => ({ ...comment, canEdit: false, canDelete: false })) } : null);
      }
    };
    window.addEventListener(communityAuthChangedEvent, syncAuth);
    return () => window.removeEventListener(communityAuthChangedEvent, syncAuth);
  }, []);

  useEffect(() => {
    const open = () => { setAuthMode("login"); setAuthOpen(true); };
    window.addEventListener(openCommunityAuthEvent, open);
    return () => window.removeEventListener(openCommunityAuthEvent, open);
  }, []);

  async function openPost(postId: number) {
    setError("");
    trackAnalytics("community_view", { postId });
    try {
      const post = await request<CommunityPost>(`/api/community/posts/${postId}`);
      setSelected(post);
      setPosts((current) => ({ ...current, items: current.items.map((item) => item.id === postId ? { ...item, viewCount: post.viewCount } : item) }));
    } catch (requestError) {
      setError(String((requestError as Error).message));
    }
  }

  function updateSelectedPost(post: CommunityPost) {
    setSelected(post);
    setPosts((current) => ({
      ...current,
      items: current.items.map((item) => item.id === post.id ? {
        ...item,
        viewCount: post.viewCount,
        commentCount: post.commentCount,
        canEdit: post.canEdit,
        canDelete: post.canDelete,
      } : item),
    }));
  }

  function requireLogin() {
    setAuthMode("login");
    setAuthOpen(true);
  }

  return (
    <section className="community-section" id="community">
      <div className="community-heading">
        <div>
          <p className="section-kicker">FC-SUPPORT COMMUNITY</p>
          <h2>감독모드 이야기를<br />함께 나누세요.</h2>
          <p>게시글과 댓글은 누구나 읽을 수 있으며, 작성은 로그인 후 가능합니다.</p>
        </div>
        <div className="community-account">
          {user ? <span><b>{user.nickname}</b></span> : <button type="button" onClick={requireLogin}>로그인 · 회원가입</button>}
        </div>
      </div>

      <div className={`community-board ${selected ? "has-selected-post" : ""}`}>
        <div className="community-list-panel">
          <nav className="community-board-tabs" aria-label="게시판 선택">{([['notice','공지'],['free','자유게시판'],['tip','팁']] as const).map(([value,label]) => <button className={category === value ? "active" : ""} type="button" key={value} onClick={() => { setCategory(value); setSelected(null); setComposerOpen(false); setSearchInput(""); setSearchQuery(""); }}>{label}</button>)}</nav>
          <div className="community-list-heading">
            <div><span>BOARD</span><h3>{{notice:"공지",free:"자유게시판",tip:"팁"}[category]}</h3><p>총 {posts.total.toLocaleString()}개</p></div>
            {(category !== "notice" || user?.isAdmin) && <button className="community-primary-button" type="button" onClick={() => user ? setComposerOpen((value) => !value) : requireLogin()}>{composerOpen ? "작성 취소" : "글쓰기"}</button>}
          </div>

          {composerOpen && user && <PostComposer category={category} onSuspended={setSuspensionNotice} onCreated={async (post) => { setComposerOpen(false); await loadPosts(0); await openPost(post.id); }} />}
          <form className="community-search" onSubmit={(event) => { event.preventDefault(); const next=searchInput.trim(); setSearchQuery(next); void loadPosts(0,next); }}><select aria-label="검색 조건" value={searchMode} onChange={(event) => setSearchMode(event.target.value as SearchMode)}><option value="title">제목</option><option value="title_content">제목+내용</option><option value="content">내용</option><option value="author">작성자</option></select><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="게시판 검색" /><button type="submit">검색</button></form>

          <div className="community-post-list" aria-live="polite">
            {loading ? <div className="community-empty"><b>게시글을 불러오는 중입니다.</b></div> : error && posts.items.length === 0 ? <div className="community-empty error"><b>{error}</b></div> : posts.items.length === 0 ? (
              <div className="community-empty"><span>NO POSTS</span><b>아직 작성된 게시글이 없습니다.</b><p>로그인 후 첫 이야기를 남겨보세요.</p></div>
            ) : posts.items.map((post) => (
              <button className={`community-post-row ${selected?.id === post.id ? "selected" : ""}`} type="button" key={post.id} onClick={() => void openPost(post.id)}>
                <span className="community-post-id">{String(post.id).padStart(3, "0")}</span>
                <span className="community-post-main"><b>{post.title}</b><small>{post.excerpt}</small></span>
                <span className="community-post-meta"><b>{post.author.nickname}</b><small>{communityDate(post.createdAt)} · 조회 {post.viewCount.toLocaleString()} · 댓글 {post.commentCount.toLocaleString()}</small></span>
              </button>
            ))}
          </div>

          {posts.total > posts.limit && <div className="community-pagination">
            <button type="button" disabled={posts.offset === 0 || loading} onClick={() => void loadPosts(Math.max(0, posts.offset - posts.limit))}>이전</button>
            <span>{Math.floor(posts.offset / posts.limit) + 1} / {Math.ceil(posts.total / posts.limit)}</span>
            <button type="button" disabled={!posts.hasMore || loading} onClick={() => void loadPosts(posts.offset + posts.limit)}>다음</button>
          </div>}
        </div>

        <div className="community-detail-panel">
          {selected ? <PostDetail post={selected} user={user} onBack={() => setSelected(null)} onLogin={requireLogin} onSuspended={setSuspensionNotice} onChanged={async () => { await loadPosts(posts.offset); setSelected(null); }} onPostChanged={updateSelectedPost} /> : (
            <div className="community-detail-empty"><span>COMMUNITY</span><h3>게시글을 선택해 주세요.</h3><p>게시글과 댓글은 로그인하지 않아도 확인할 수 있습니다.</p></div>
          )}
        </div>
      </div>

      {authOpen && <AuthDialog mode={authMode} onMode={setAuthMode} onClose={() => setAuthOpen(false)} onAuthenticated={async (nextUser) => { setUser(nextUser); notifyCommunityAuth(nextUser); setAuthOpen(false); await loadPosts(posts.offset); }} />}
      {suspensionNotice && <SuspensionDialog notice={suspensionNotice} onClose={() => setSuspensionNotice(null)} />}
    </section>
  );
}

function PostComposer({ category, onCreated, onSuspended }: { category: BoardCategory; onCreated: (post: CommunityPost) => Promise<void>; onSuspended: (notice: RestrictionNotice) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const post = await request<CommunityPost>("/api/community/posts", { method: "POST", body: JSON.stringify({ category, title, content }) });
      await onCreated(post);
    } catch (requestError) {
      if (requestError instanceof CommunityRequestError && requestError.code === "POSTING_SUSPENDED" && requestError.restriction) onSuspended(requestError.restriction);
      else setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return <form className="community-composer" onSubmit={submit}>
    <label>제목<input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="제목을 입력해 주세요." /></label>
    <label>내용<textarea maxLength={5000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="감독모드 이야기를 작성해 주세요." /></label>
    {error && <p className="community-form-error">{error}</p>}
    <div><small>{content.length.toLocaleString()} / 5,000</small><button className="community-primary-button" disabled={saving} type="submit">{saving ? "등록 중" : "게시글 등록"}</button></div>
  </form>;
}

function PostDetail({ post, user, onBack, onLogin, onSuspended, onChanged, onPostChanged }: { post: CommunityPost; user: CommunityUser | null; onBack: () => void; onLogin: () => void; onSuspended: (notice: RestrictionNotice) => void; onChanged: () => Promise<void>; onPostChanged: (post: CommunityPost) => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: "post" | "comment"; id: number } | null>(null);
  const [editingPost, setEditingPost] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editContent, setEditContent] = useState(post.content);
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editComment, setEditComment] = useState("");

  async function removePost() {
    if (!window.confirm("이 게시글을 삭제하시겠습니까?")) return;
    await request<{ ok: true }>(`/api/community/posts/${post.id}`, { method: "DELETE" });
    await onChanged();
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return onLogin();
    setSaving(true);
    setError("");
    try {
      await request<CommunityComment>(`/api/community/posts/${post.id}/comments`, { method: "POST", body: JSON.stringify({ content: comment }) });
      setComment("");
      onPostChanged(await request<CommunityPost>(`/api/community/posts/${post.id}`));
    } catch (requestError) {
      if (requestError instanceof CommunityRequestError && requestError.code === "POSTING_SUSPENDED" && requestError.restriction) onSuspended(requestError.restriction);
      else setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  async function removeComment(commentId: number) {
    if (!window.confirm("이 댓글을 삭제하시겠습니까?")) return;
    await request<{ ok: true }>(`/api/community/comments/${commentId}`, { method: "DELETE" });
    onPostChanged(await request<CommunityPost>(`/api/community/posts/${post.id}`));
  }

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await request<CommunityPost>(`/api/community/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ title: editTitle, content: editContent }) });
    setEditingPost(false); onPostChanged(updated);
  }

  async function saveComment(commentId: number) {
    await request<CommunityComment>(`/api/community/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ content: editComment }) });
    setEditingComment(null); onPostChanged(await request<CommunityPost>(`/api/community/posts/${post.id}`));
  }

  return <article className="community-detail">
    <button className="community-mobile-back" type="button" onClick={onBack}>← 게시글 목록</button>
    <header><div><span>{post.category === "notice" ? "NOTICE" : "POST"} {String(post.id).padStart(3, "0")}</span><h3>{post.title}</h3><p>{post.author.nickname} · {communityDate(post.createdAt)} · 조회 {post.viewCount.toLocaleString()}</p></div><div className="community-moderation-actions"><button type="button" onClick={() => setReportTarget({ type:"post", id:post.id })}>게시글 신고</button>{post.canEdit && <button type="button" onClick={() => setEditingPost(true)}>게시글 수정</button>}{post.canDelete && <button type="button" onClick={() => void removePost()}>게시글 삭제</button>}</div></header>
    {editingPost ? <form className="community-composer community-edit-form" onSubmit={savePost}><label>제목<input maxLength={80} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label>내용<textarea maxLength={5000} value={editContent} onChange={(event) => setEditContent(event.target.value)} /></label><div><button type="button" onClick={() => setEditingPost(false)}>취소</button><button className="community-primary-button" type="submit">수정 저장</button></div></form> : <div className="community-post-content">{post.content}</div>}
    {post.category === "notice" ? <section className="community-comments-disabled"><b>공지사항은 읽기 전용입니다.</b><p>공지에는 댓글을 작성할 수 없습니다.</p></section> : <section className="community-comments">
      <div className="community-comments-heading"><h4>댓글</h4><span>{(post.comments?.length || 0).toLocaleString()}개</span></div>
      <div className="community-comment-list">
        {post.comments?.length ? post.comments.map((item) => <article key={item.id}><div><b>{item.author.nickname}</b><small>{communityDate(item.createdAt)}</small></div>{editingComment === item.id ? <div className="community-comment-edit"><textarea maxLength={1000} value={editComment} onChange={(event) => setEditComment(event.target.value)} /><button type="button" onClick={() => setEditingComment(null)}>취소</button><button type="button" onClick={() => void saveComment(item.id)}>저장</button></div> : <p>{item.content}</p>}<div className="community-comment-actions"><button type="button" onClick={() => setReportTarget({ type:"comment", id:item.id })}>신고</button>{item.canEdit && <button type="button" onClick={() => { setEditingComment(item.id); setEditComment(item.content); }}>수정</button>}{item.canDelete && <button type="button" onClick={() => void removeComment(item.id)}>삭제</button>}</div></article>) : <p className="community-no-comments">아직 댓글이 없습니다.</p>}
      </div>
      <form className="community-comment-form" onSubmit={submitComment}>
        <textarea maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={user ? "댓글을 입력해 주세요." : "로그인 후 댓글을 작성할 수 있습니다."} onFocus={() => { if (!user) onLogin(); }} />
        {error && <p className="community-form-error">{error}</p>}
        <button className="community-primary-button" type="submit" disabled={saving}>{saving ? "등록 중" : "댓글 등록"}</button>
      </form>
    </section>}
    {reportTarget && <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />}
  </article>;
}

function restrictionDate(value?: string) {
  return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(new Date(value)) : "—";
}

function restrictionDays(notice: RestrictionNotice) {
  if (notice.permanent || !notice.startsAt || !notice.endsAt) return "영구";
  return `${Math.max(1, Math.ceil((new Date(notice.endsAt).getTime() - new Date(notice.startsAt).getTime()) / 86_400_000))}일`;
}

function SuspensionDialog({ notice, onClose }: { notice: RestrictionNotice; onClose: () => void }) {
  return <div className="community-auth-overlay" role="presentation"><div className="community-auth-dialog community-restriction-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restriction-title"><span className="restriction-mark">POSTING SUSPENDED</span><h3 id="restriction-title">{notice.nickname || "회원"}님은 글쓰기가 정지되었습니다.</h3><p>게시글과 댓글을 읽거나 검색할 수는 있지만, 제한 기간에는 새 글과 댓글을 작성할 수 없습니다.</p><dl><div><dt>정지 기간</dt><dd>{restrictionDays(notice)}</dd></div><div><dt>정지 사유</dt><dd>{notice.reasonText || notice.reasonCode}</dd></div><div><dt>해제일</dt><dd>{notice.permanent ? "영구 정지" : restrictionDate(notice.endsAt)}</dd></div></dl><button className="community-primary-button" type="button" onClick={onClose}>확인</button></div></div>;
}

function ReportDialog({ target, onClose }: { target: { type: "post" | "comment"; id: number }; onClose: () => void }) {
  const [reasonCode, setReasonCode] = useState("spam");
  const [reasonText, setReasonText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await request("/api/community/reports", { method:"POST", body:JSON.stringify({ targetType:target.type, targetId:target.id, reasonCode, reasonText, pageUrl:location.href }) });
      window.alert("신고가 접수되었습니다."); onClose();
    } catch (requestError) { setError(String((requestError as Error).message)); }
    finally { setSaving(false); }
  }
  return <div className="community-auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="community-auth-dialog community-report-dialog" role="dialog" aria-modal="true"><button className="community-auth-close" type="button" onClick={onClose}>×</button><p className="section-kicker">CONTENT REPORT</p><h3>{target.type === "post" ? "게시글" : "댓글"} 신고</h3><form onSubmit={submit}><label>신고 사유<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="spam">도배·스팸</option><option value="abuse">욕설·비방·괴롭힘</option><option value="inappropriate">부적절한 콘텐츠</option><option value="impersonation">사칭·허위 정보</option><option value="terms">운영정책 위반</option><option value="other">기타</option></select></label><label>상세 사유<textarea maxLength={1000} required={reasonCode === "other"} value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder={reasonCode === "other" ? "기타 사유를 입력해 주세요." : "필요한 경우 상세 내용을 입력해 주세요."} /></label>{error && <p className="community-form-error">{error}</p>}<button className="community-primary-button" disabled={saving} type="submit">{saving ? "접수 중" : "신고 접수"}</button></form></div></div>;
}

function AuthDialog({ mode, onMode, onClose, onAuthenticated }: { mode: "login" | "register"; onMode: (mode: "login" | "register") => void; onClose: () => void; onAuthenticated: (user: CommunityUser) => Promise<void> }) {
  const [loginId, setLoginId] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request<{ user: CommunityUser }>(`/api/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body: JSON.stringify({ loginId, nickname, password }) });
      await onAuthenticated(result.user);
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return <div className="community-auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="community-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="community-auth-title">
      <button className="community-auth-close" type="button" aria-label="닫기" onClick={onClose}>×</button>
      <p className="section-kicker">FC-SUPPORT MEMBER</p>
      <h3 id="community-auth-title">{mode === "login" ? "로그인" : "회원가입"}</h3>
      <div className="community-auth-tabs"><button className={mode === "login" ? "active" : ""} type="button" onClick={() => { onMode("login"); setError(""); }}>로그인</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => { onMode("register"); setError(""); }}>회원가입</button></div>
      <form onSubmit={submit}>
        <label>아이디<input autoComplete="username" minLength={4} maxLength={20} value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="영문, 숫자, 밑줄 4~20자" /></label>
        {mode === "register" && <label>닉네임<input autoComplete="nickname" minLength={2} maxLength={16} pattern="[가-힣A-Za-z0-9]+" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="공백 없이 한글, 영문, 숫자 2~16자" /></label>}
        <label>비밀번호<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={72} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" /></label>
        {error && <p className="community-form-error">{error}</p>}
        <button className="community-primary-button" disabled={saving} type="submit">{saving ? "처리 중" : mode === "login" ? "로그인" : "회원가입"}</button>
      </form>
    </div>
  </div>;
}
