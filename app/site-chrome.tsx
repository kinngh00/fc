"use client";

import { useEffect, useState } from "react";
import { NotificationBell, communityAuthChangedEvent, notifyCommunityAuth } from "./community";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";
export type SiteNavKey = "pick" | "players" | "managers" | "ranking" | "community" | "faq" | null;

export function SiteHeader({ active = null }: { active?: SiteNavKey }) {
  const [headerUser, setHeaderUser] = useState<{ nickname: string } | null>(null);
  const [managerQuery, setManagerQuery] = useState("");

  useEffect(() => {
    const syncAuth = (event: Event) => setHeaderUser((event as CustomEvent<{ nickname: string } | null>).detail);
    window.addEventListener(communityAuthChangedEvent, syncAuth);
    fetch(`${apiBaseUrl}/api/auth/me`, { credentials: "include", cache: "no-store" })
      .then((response) => response.json()).then((payload) => setHeaderUser(payload.user || null)).catch(() => setHeaderUser(null));
    return () => window.removeEventListener(communityAuthChangedEvent, syncAuth);
  }, []);

  async function logoutFromHeader() {
    await fetch(`${apiBaseUrl}/api/auth/logout`, { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}" });
    setHeaderUser(null);
    notifyCommunityAuth(null);
  }

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="FC-SUPPORT 홈">
        <span className="brand-mark">FC</span><span>SUPPORT</span>
      </a>
      <nav aria-label="주요 메뉴">
        <a className={active === "pick" ? "active" : ""} href="/pick">픽률 분석</a>
        <a className={active === "players" ? "active" : ""} href="/players">선수</a>
        <a className={active === "managers" ? "active" : ""} href="/managers">구단주 검색</a>
        <a className={active === "ranking" ? "active" : ""} href="/ranking">랭킹</a>
        <a className={active === "community" ? "active" : ""} href="/community">커뮤니티</a>
        <a className={active === "faq" ? "active" : ""} href="/faq">FAQ</a>
      </nav>
      <div className="header-actions">
        <form className="header-manager-search" role="search" onSubmit={(event) => { event.preventDefault(); const nickname = managerQuery.trim(); if (nickname) window.location.href = `/managers?nickname=${encodeURIComponent(nickname)}`; }}>
          <input aria-label="감독 검색" placeholder="감독명 검색..." value={managerQuery} onChange={(event) => setManagerQuery(event.target.value)} />
          <button type="submit" aria-label="감독 검색 실행"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg></button>
        </form>
        {headerUser ? <div className="header-account"><a className="header-account-link" href="/mypage">{headerUser.nickname}</a><NotificationBell user={headerUser} /><button className="login-button" type="button" onClick={() => void logoutFromHeader()}>로그아웃</button></div> : <button className="login-button" type="button" onClick={() => { window.location.href = "/community?auth=login"; }}>로그인</button>}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="simple-footer">
      <div className="simple-footer-frame">
        <a className="brand" href="/" aria-label="FC-SUPPORT 홈"><span className="brand-mark">FC</span><span>SUPPORT</span></a>
        <nav aria-label="하단 메뉴">
          <a href="/privacy">개인정보처리방침</a>
          <a href="/terms">이용약관</a>
          <a href="/community?compose=inquiry">신고·운영 문의</a>
          <a href="/faq">FAQ</a>
        </nav>
        <small>© {new Date().getFullYear()} FC-SUPPORT · fc-support@naver.com</small>
      </div>
    </footer>
  );
}
