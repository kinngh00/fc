"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { trackAnalytics } from "./analytics";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";
export const openCommunityAuthEvent = "fc-support:open-community-auth";
export const communityAuthChangedEvent = "fc-support:community-auth-changed";
export const openCommunityInquiryEvent = "fc-support:open-community-inquiry";

type CommunityUser = { id: number; loginId: string; nickname: string; gameNickname?: string | null; gameNicknamePublic?: boolean; profileComplete?: boolean; role: "super_admin" | "admin" | "member"; isAdmin: boolean; isSuperAdmin?: boolean; createdAt: string };
export function notifyCommunityAuth(user: CommunityUser | null) {
  window.dispatchEvent(new CustomEvent(communityAuthChangedEvent, { detail: user }));
}
type BoardCategory = "notice" | "free" | "tip" | "question" | "inquiry";
type SearchMode = "title" | "title_content" | "content" | "author";
type CommunityComment = { id: number; content: string; createdAt: string; author: { id: number; nickname: string; gameNickname?: string | null }; canEdit: boolean; canDelete: boolean };
type CommunityPost = {
  id: number;
  category: BoardCategory;
  isSecret: boolean;
  isDeleted: boolean;
  title: string;
  content: string;
  excerpt: string;
  viewCount: number;
  commentCount: number;
  createdAt: string;
  author: { id: number; nickname: string; gameNickname?: string | null };
  canEdit: boolean;
  canDelete: boolean;
  comments?: CommunityComment[];
};
type PostList = { total: number; items: CommunityPost[]; offset: number; limit: number; hasMore: boolean };
type CommunityHighlights = { notice: CommunityPost | null; notices: CommunityPost[]; popular: CommunityPost[] };
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

type NotificationItem = {
  id: number;
  type: "comment";
  postId: number;
  commentId: number | null;
  category: string;
  postTitle: string;
  actorNickname: string;
  preview: string;
  isRead: boolean;
  createdAt: string;
};
type NotificationList = { items: NotificationItem[]; total: number; unreadCount: number; offset: number; limit: number; hasMore: boolean };

function notificationLabel(item: NotificationItem) {
  return `${item.actorNickname}님이 댓글을 남겼습니다`;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>;
}

function NotificationToast({ item, onOpen, onDismiss }: { item: NotificationItem; onOpen: () => void; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setLeaving(true), 4700);
    const removeTimer = window.setTimeout(onDismiss, 5000);
    return () => { window.clearTimeout(leaveTimer); window.clearTimeout(removeTimer); };
  }, [onDismiss]);
  return (
    <div className={`notification-toast${leaving ? " leaving" : ""}`} role="alert">
      <button type="button" className="notification-toast-body" onClick={onOpen}>
        <span className="notification-toast-title">{notificationLabel(item)}</span>
        <span className="notification-toast-post">{item.postTitle}</span>
        <p>{item.preview}</p>
      </button>
      <button type="button" className="notification-toast-close" aria-label="알림 닫기" onClick={onDismiss}>×</button>
    </div>
  );
}

export function NotificationBell({ user }: { user: { nickname: string } | null }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const seenIds = useRef<Set<number>>(new Set());
  const initialized = useRef(false);

  const goTo = useCallback(async (item: NotificationItem) => {
    setToasts((current) => current.filter((toast) => toast.id !== item.id));
    setItems((current) => current.map((existing) => existing.id === item.id ? { ...existing, isRead: true } : existing));
    if (!item.isRead) setUnreadCount((count) => Math.max(0, count - 1));
    setOpen(false);
    try { await request(`/api/notifications/${item.id}/read`, { method: "POST", body: "{}" }); } catch { /* ignore */ }
    window.location.href = `/community?category=${item.category}&post=${item.postId}`;
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function poll() {
      try {
        const result = await request<NotificationList>("/api/notifications?filter=unread&limit=30");
        if (cancelled) return;
        setUnreadCount(result.unreadCount);
        if (!initialized.current) {
          initialized.current = true;
          for (const item of result.items) seenIds.current.add(item.id);
          return;
        }
        const fresh = result.items.filter((item) => !seenIds.current.has(item.id));
        if (fresh.length) {
          for (const item of fresh) seenIds.current.add(item.id);
          setToasts((current) => [...fresh.slice(0, 3), ...current].slice(0, 4));
        }
      } catch { /* ignore transient polling errors */ }
    }
    void poll();
    const interval = window.setInterval(poll, 15000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [user]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    void request<NotificationList>(`/api/notifications?filter=${filter}&limit=30`).then((result) => { if (!cancelled) setItems(result.items); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, filter, user]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      const panel = document.getElementById("notification-panel");
      const button = document.getElementById("notification-bell-button");
      if (panel?.contains(event.target) || button?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  if (!user) return null;

  return <div className="notification-bell">
    <button id="notification-bell-button" type="button" className="notification-bell-button" aria-label="알림" onClick={() => setOpen((value) => !value)}>
      <BellIcon />
      {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </button>
    {open && <div id="notification-panel" className="notification-panel">
      <div className="notification-panel-tabs">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체</button>
        <button type="button" className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>미확인</button>
        <button type="button" className={filter === "read" ? "active" : ""} onClick={() => setFilter("read")}>확인</button>
      </div>
      <div className="notification-panel-list">
        {items.length === 0 && <p className="notification-empty">알림이 없습니다.</p>}
        {items.map((item) => <button key={item.id} type="button" className={`notification-item${item.isRead ? "" : " unread"}`} onClick={() => void goTo(item)}>
          <span className="notification-item-title">{notificationLabel(item)}</span>
          <span className="notification-item-post">{item.postTitle}</span>
          <small>{communityDate(item.createdAt)}</small>
        </button>)}
      </div>
    </div>}
    <div className="notification-toast-stack">
      {toasts.map((toast) => <NotificationToast key={toast.id} item={toast} onOpen={() => void goTo(toast)} onDismiss={() => setToasts((current) => current.filter((entry) => entry.id !== toast.id))} />)}
    </div>
  </div>;
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
  const [category, setCategory] = useState<BoardCategory>("notice");
  const [searchMode, setSearchMode] = useState<SearchMode>("title_content");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [initialRouteHandled, setInitialRouteHandled] = useState(false);

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
      .then((result) => { setUser(result.user); notifyCommunityAuth(result.user); if (result.user && !result.user.profileComplete) setAuthOpen(true); })
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

  useEffect(() => {
    const openInquiry = () => {
      if (!user) { setAuthMode("login"); setAuthOpen(true); return; }
      setCategory("inquiry");
      setSelected(null);
      setComposerOpen(true);
      setSearchInput("");
      setSearchQuery("");
    };
    window.addEventListener(openCommunityInquiryEvent, openInquiry);
    return () => window.removeEventListener(openCommunityInquiryEvent, openInquiry);
  }, [user]);

  useEffect(() => {
    if (initialRouteHandled || loading) return;
    const params = new URLSearchParams(window.location.search);
    const nextCategory = params.get("category");
    if (nextCategory === "notice" || nextCategory === "free" || nextCategory === "tip" || nextCategory === "question" || nextCategory === "inquiry") setCategory(nextCategory);
    const postId = Number(params.get("post"));
    if (Number.isInteger(postId) && postId > 0) void openPost(postId);
    if (params.get("auth")) { setAuthMode("login"); setAuthOpen(true); }
    if (params.get("compose") === "inquiry") {
      if (user) { setCategory("inquiry"); setComposerOpen(true); }
      else { setAuthMode("login"); setAuthOpen(true); }
    }
    setInitialRouteHandled(true);
  }, [initialRouteHandled, loading, user]);

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
        <p className="section-kicker">FC-SUPPORT COMMUNITY</p>
        <h2>감독모드 이야기를<br />함께 나누세요.</h2>
        <p className="community-heading-description">게시글과 댓글은 누구나 읽을 수 있으며, 작성은 로그인 후 가능합니다.</p>
      </div>

      <div className={`community-board ${selected ? "has-selected-post" : ""}`}>
        <div className="community-list-panel">
          {category === "inquiry" ? (
            <div className="community-inquiry-panel">
              <p className="section-kicker">SUPPORT</p>
              <h3>문의·건의 작성</h3>
              <p className="community-inquiry-notice">문의·건의는 목록으로 공개되지 않으며, 운영자만 관리자 페이지에서 확인하고 답변합니다.</p>
              {user ? <PostComposer category="inquiry" onSuspended={setSuspensionNotice} onCreated={async () => { window.alert("문의·건의가 접수되었습니다. 답변은 운영자가 검토 후 등록합니다."); setCategory("free"); }} /> : <button className="community-primary-button" type="button" onClick={requireLogin}>로그인하고 작성하기</button>}
            </div>
          ) : (
            <>
              <nav className="community-board-tabs" aria-label="게시판 선택">{([['notice','공지'],['free','자유게시판'],['tip','팁'],['question','질문']] as const).map(([value,label]) => <button className={category === value ? "active" : ""} type="button" key={value} onClick={() => { setCategory(value); setSelected(null); setComposerOpen(false); setSearchInput(""); setSearchQuery(""); }}>{label}</button>)}</nav>
              {composerOpen && user && <PostComposer category={category} onSuspended={setSuspensionNotice} onCreated={async (post) => { setComposerOpen(false); await loadPosts(0); await openPost(post.id); }} />}
              <form className="community-search" onSubmit={(event) => { event.preventDefault(); const next=searchInput.trim(); setSearchQuery(next); void loadPosts(0,next); }}><select aria-label="검색 조건" value={searchMode} onChange={(event) => setSearchMode(event.target.value as SearchMode)}><option value="title">제목</option><option value="title_content">제목+내용</option><option value="content">내용</option><option value="author">작성자</option></select><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="게시판 검색" /><button type="submit">검색</button>{(category !== "notice" || user?.isAdmin) && <button className="community-write-button" type="button" onClick={() => user ? setComposerOpen((value) => !value) : requireLogin()}>{composerOpen ? "작성 취소" : "글쓰기"}</button>}</form>

              <div className="community-post-list" aria-live="polite">
            {loading ? <div className="community-empty"><b>게시글을 불러오는 중입니다.</b></div> : error && posts.items.length === 0 ? <div className="community-empty error"><b>{error}</b></div> : posts.items.length === 0 ? (
              <div className="community-empty"><span>NO POSTS</span><b>아직 작성된 게시글이 없습니다.</b><p>로그인 후 첫 이야기를 남겨보세요.</p></div>
            ) : posts.items.map((post) => (
              <button className={`community-post-row ${selected?.id === post.id ? "selected" : ""}`} type="button" key={post.id} onClick={() => void openPost(post.id)}>
                <span className="community-post-id">{String(post.id).padStart(3, "0")}</span>
                <span className="community-post-main"><b>{post.isDeleted ? <span className="community-deleted-mark">삭제됨(관리자만 표시)</span> : null}{post.isSecret ? <span className="community-secret-mark">비밀</span> : null}{post.title}</b><small>{post.excerpt}</small></span>
                <span className="community-post-meta"><small>{communityDate(post.createdAt)} · 조회 {post.viewCount.toLocaleString()} · 댓글 {post.commentCount.toLocaleString()}</small></span>
              </button>
            ))}
          </div>

          {posts.total > posts.limit && <div className="community-pagination">
            <button type="button" disabled={posts.offset === 0 || loading} onClick={() => void loadPosts(Math.max(0, posts.offset - posts.limit))}>이전</button>
            <span>{Math.floor(posts.offset / posts.limit) + 1} / {Math.ceil(posts.total / posts.limit)}</span>
            <button type="button" disabled={!posts.hasMore || loading} onClick={() => void loadPosts(posts.offset + posts.limit)}>다음</button>
          </div>}
            </>
          )}
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

export function CommunityPreview() {
  const [highlights, setHighlights] = useState<CommunityHighlights>({ notice: null, notices: [], popular: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void request<CommunityHighlights>("/api/community/highlights")
      .then(setHighlights)
      .catch((requestError) => setError(String((requestError as Error).message)))
      .finally(() => setLoading(false));
  }, []);
  const postLink = (post: CommunityPost) => `/community?category=${post.category}&post=${post.id}`;
  return <section className="community-preview" id="community">
    <div className="community-preview-grid">
      <article className="community-preview-panel community-preview-notice">
        <header><h2>공지사항</h2><a href="/community?category=notice">전체보기</a></header>
        <div className="community-preview-list">
          {loading ? <p className="community-preview-state">게시글을 불러오는 중입니다.</p> : error ? <p className="community-preview-state">{error}</p> : highlights.notices.length === 0 ? <p className="community-preview-state">등록된 공지가 없습니다.</p> : highlights.notices.map((post) => <a href={postLink(post)} key={post.id}>
            <span className="community-notice-badge">공지</span><b>{post.title}</b><small>{communityDate(post.createdAt)}</small>
          </a>)}
        </div>
      </article>
      <article className="community-preview-panel community-preview-popular">
        <header><h2>인기 게시글</h2><a href="/community">전체보기</a></header>
        <div className="community-preview-list">
          {loading ? <p className="community-preview-state">게시글을 불러오는 중입니다.</p> : error ? <p className="community-preview-state">{error}</p> : highlights.popular.length === 0 ? <p className="community-preview-state">등록된 게시글이 없습니다.</p> : highlights.popular.map((post, index) => <a href={postLink(post)} key={post.id}>
            <em>{index + 1}</em><b>{post.title}</b><span className="community-preview-comments">댓글 {post.commentCount.toLocaleString()}</span><small>{communityDate(post.createdAt)}</small>
          </a>)}
        </div>
      </article>
    </div>
  </section>;
}

function PostComposer({ category, onCreated, onSuspended }: { category: BoardCategory; onCreated: (post: CommunityPost) => Promise<void>; onSuspended: (notice: RestrictionNotice) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const post = await request<CommunityPost>("/api/community/posts", { method: "POST", body: JSON.stringify({ category, title, content, isSecret: category === "question" && isSecret }) });
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
    {category === "question" && <label className="community-secret-check"><input type="checkbox" checked={isSecret} onChange={(event) => setIsSecret(event.target.checked)} /><span><b>비밀글</b><small>작성자 본인과 관리자 이상만 글과 답변을 확인할 수 있습니다.</small></span></label>}
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
    <header><div><span>{post.category === "notice" ? "NOTICE" : post.category === "question" ? "QUESTION" : "POST"} {String(post.id).padStart(3, "0")}{post.isSecret ? " · SECRET" : ""}{post.isDeleted ? " · DELETED (관리자만 표시)" : ""}</span><h3>{post.title}</h3><p>{post.author.nickname}{post.author.gameNickname ? ` · 게임 ${post.author.gameNickname}` : ""} · {communityDate(post.createdAt)} · 조회 {post.viewCount.toLocaleString()}</p></div><div className="community-moderation-actions"><button type="button" onClick={() => setReportTarget({ type:"post", id:post.id })}>게시글 신고</button>{post.canEdit && <button type="button" onClick={() => setEditingPost(true)}>게시글 수정</button>}{post.canDelete && <button type="button" onClick={() => void removePost()}>게시글 삭제</button>}</div></header>
    {editingPost ? <form className="community-composer community-edit-form" onSubmit={savePost}><label>제목<input maxLength={80} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label>내용<textarea maxLength={5000} value={editContent} onChange={(event) => setEditContent(event.target.value)} /></label><div><button type="button" onClick={() => setEditingPost(false)}>취소</button><button className="community-primary-button" type="submit">수정 저장</button></div></form> : <div className="community-post-content">{post.content}</div>}
    {post.category === "notice" ? <section className="community-comments-disabled"><b>공지사항은 읽기 전용입니다.</b><p>공지에는 댓글을 작성할 수 없습니다.</p></section> : <section className="community-comments">
      <div className="community-comments-heading"><h4>댓글</h4><span>{(post.comments?.length || 0).toLocaleString()}개</span></div>
      <div className="community-comment-list">
        {post.comments?.length ? post.comments.map((item) => <article key={item.id}><div><b>{item.author.nickname}{item.author.gameNickname ? ` · 게임 ${item.author.gameNickname}` : ""}</b><small>{communityDate(item.createdAt)}</small></div>{editingComment === item.id ? <div className="community-comment-edit"><textarea maxLength={1000} value={editComment} onChange={(event) => setEditComment(event.target.value)} /><button type="button" onClick={() => setEditingComment(null)}>취소</button><button type="button" onClick={() => void saveComment(item.id)}>저장</button></div> : <p>{item.content}</p>}<div className="community-comment-actions"><button type="button" onClick={() => setReportTarget({ type:"comment", id:item.id })}>신고</button>{item.canEdit && <button type="button" onClick={() => { setEditingComment(item.id); setEditComment(item.content); }}>수정</button>}{item.canDelete && <button type="button" onClick={() => void removeComment(item.id)}>삭제</button>}</div></article>) : <p className="community-no-comments">아직 댓글이 없습니다.</p>}
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

function AuthDialog({ onClose, onAuthenticated }: { mode: "login" | "register"; onMode: (mode: "login" | "register") => void; onClose: () => void; onAuthenticated: (user: CommunityUser) => Promise<void> }) {
  const [nickname, setNickname] = useState("");
  const [gameNickname, setGameNickname] = useState("");
  const [gameNicknamePublic, setGameNicknamePublic] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void request<{user:CommunityUser|null}>("/api/auth/me").then(({user}) => setNeedsProfile(Boolean(user && !user.profileComplete))).catch(() => {});
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request<{ user: CommunityUser }>("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ nickname, gameNickname, gameNicknamePublic }) });
      await onAuthenticated(result.user);
    } catch (requestError) {
      setError(String((requestError as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return <div className="community-auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="community-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="community-auth-title">
      {!needsProfile && <button className="community-auth-close" type="button" aria-label="닫기" onClick={onClose}>×</button>}
      <p className="section-kicker">FC-SUPPORT MEMBER</p>
      <h3 id="community-auth-title">{needsProfile ? "프로필 설정" : "로그인"}</h3>
      {needsProfile ? <form onSubmit={submit}><p className="community-auth-copy">사이트에서 사용할 정보를 한 번만 설정해 주세요.</p><label>사이트 닉네임<input required autoComplete="nickname" minLength={2} maxLength={16} pattern="[가-힣A-Za-z0-9]+" value={nickname} onChange={(event)=>setNickname(event.target.value)} placeholder="한글, 영문, 숫자 2~16자" /></label><label>게임 닉네임<input required minLength={2} maxLength={20} value={gameNickname} onChange={(event)=>setGameNickname(event.target.value)} placeholder="FC온라인 구단주명 · 중복 가능" /></label><label className="community-agreement-check"><input type="checkbox" checked={gameNicknamePublic} onChange={(event)=>setGameNicknamePublic(event.target.checked)} /><span>다른 회원에게 게임 닉네임 공개</span></label>{error && <p className="community-form-error">{error}</p>}<button className="community-primary-button" disabled={saving} type="submit">{saving ? "저장 중" : "프로필 저장"}</button></form> : <><p className="community-auth-copy">별도 아이디와 비밀번호 없이 Google 계정으로 안전하게 시작합니다.</p><a className="community-google-button" href={`${apiBaseUrl}/api/auth/google`}><span aria-hidden="true">G</span>Google로 로그인</a><small className="community-auth-notice">로그인하면 <a href="/terms">이용약관</a>과 <a href="/privacy">개인정보처리방침</a>에 동의한 것으로 봅니다.</small>{error && <p className="community-form-error">{error}</p>}</>}
    </div>
  </div>;
}
