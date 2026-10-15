"use client";

import { ReactNode, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";
type Ban = { reasonCode: string; reasonText?: string; startsAt?: string; permanent: boolean; endsAt?: string };
type BlockNotice = { ban: Ban; currentIp: string; nickname?: string | null };

function restrictionDate(value?: string) {
  return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(new Date(value)) : "—";
}

function restrictionDays(ban: Ban) {
  if (ban.permanent || !ban.startsAt || !ban.endsAt) return "영구";
  return `${Math.max(1, Math.ceil((new Date(ban.endsAt).getTime() - new Date(ban.startsAt).getTime()) / 86_400_000))}일`;
}

export default function AccessGuard({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState<BlockNotice | null>(null);
  useEffect(() => {
    if (location.pathname.startsWith("/admin")) { setChecking(false); return; }
    fetch(`${apiBase}/api/access`, { credentials: "include", cache: "no-store" })
      .then(async (response) => { const payload = await response.json(); if (!response.ok && payload.blocked) setNotice({ ban: payload.ban, currentIp: payload.currentIp, nickname: payload.nickname }); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  if (checking) return children;
  if (notice) return <main className="access-blocked"><div><span>ACCESS BLOCKED</span><h1>접속이 차단되었습니다.</h1><p>{notice.nickname ? `${notice.nickname}님이 접속한 ` : "현재 접속한 "}<b>{notice.currentIp}</b> IP는 운영정책에 따라 FC-SUPPORT 이용이 제한되어 있습니다.</p><dl><div><dt>차단 기간</dt><dd>{restrictionDays(notice.ban)}</dd></div><div><dt>차단 사유</dt><dd>{notice.ban.reasonText || notice.ban.reasonCode}</dd></div><div><dt>해제일</dt><dd>{notice.ban.permanent ? "영구 차단" : restrictionDate(notice.ban.endsAt)}</dd></div></dl><small>문의 시 위 접속 IP와 차단 사유를 함께 알려주세요.</small></div></main>;
  return children;
}

