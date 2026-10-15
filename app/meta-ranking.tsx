"use client";

import { useEffect, useState } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";

type MetaItem = { name: string; count: number; rate: number; image?: string | null };
type MetaResponse = {
  snapshot: { id: number; data_time: string } | null;
  formations: { sampleSize: number; items: MetaItem[] };
  teamColors: { sampleSize: number; items: MetaItem[] };
};

export type MetaTab = "formations" | "team-colors";

function MetaFormationPitch({ name }: { name: string }) {
  const lines = name.split("-").map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const players = lines.flatMap((count, lineIndex) => {
    const y = 73 - lineIndex * (51 / Math.max(1, lines.length - 1));
    return Array.from({ length: count }, (_, playerIndex) =>
      `<circle cx="${((playerIndex + 1) * 160 / (count + 1)).toFixed(1)}" cy="${y.toFixed(1)}" r="4.2"/>`);
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#123f25"/><stop offset="1" stop-color="#071f12"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="2.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="160" height="100" rx="8" fill="url(#field)"/><g fill="none" stroke="#a9d934" stroke-opacity=".72" stroke-width="1.3"><path d="M7 7h146v86H7zM7 50h146M59 7v13h42V7M59 93V80h42v13"/><circle cx="80" cy="50" r="13"/><path d="M7 28h25V7m96 0v21h25M7 72h25v21m96 0V72h25"/></g><g fill="#c8ff3d" stroke="#efffc6" stroke-width=".8" filter="url(#glow)"><circle cx="80" cy="87" r="4.2"/>${players}</g></svg>`;
  return <img className="meta-rank-formation" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`${name} 포메이션 배치`} loading="lazy" decoding="async" />;
}

function MetaRankCard({ item, rank, formation }: { item: MetaItem; rank: number; formation?: boolean }) {
  return <article className={`meta-rank-card${rank === 1 ? " is-first" : ""}`}>
    <strong className="meta-rank-number">{rank}</strong>
    {item.image ? <span className="meta-rank-logo"><img src={item.image} alt={`${item.name} 로고`} loading="lazy" decoding="async" /></span> : null}
    <div className="meta-rank-copy"><h3>{item.name}</h3><p>{item.count.toLocaleString()}명 · {item.rate.toFixed(1)}%</p></div>
    {formation ? <MetaFormationPitch name={item.name} /> : null}
    <div className="meta-rank-meter"><i style={{ width: `${Math.max(2, item.rate)}%` }} /></div>
  </article>;
}

function MetaRankingSection({ id, kicker, title, description, items, formation = false }: { id: string; kicker: string; title: string; description: string; items: MetaItem[]; formation?: boolean }) {
  return <section className="meta-ranking-section" id={id}>
    <header><div><div className="section-kicker">{kicker}</div><h2>{title}</h2><p>{description}</p></div><strong>{items.length.toLocaleString()}개 랭킹</strong></header>
    {items.length ? <div className="meta-ranking-grid">{items.map((item, index) => <MetaRankCard formation={formation} item={item} key={item.name} rank={index + 1} />)}</div> : <p className="meta-ranking-empty">집계된 랭킹이 없습니다.</p>}
  </section>;
}

export function MetaRankingContent({ activeTab, onSnapshot }: { activeTab: MetaTab; onSnapshot?: (value: string | undefined) => void }) {
  const [data, setData] = useState<MetaResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/api/home-insights`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "랭킹 데이터를 불러오지 못했습니다.");
        setData(payload);
        onSnapshot?.(payload.snapshot?.data_time);
      })
      .catch((requestError) => { if (requestError?.name !== "AbortError") setError(requestError instanceof Error ? requestError.message : "랭킹 데이터를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [onSnapshot]);

  if (error) return <p className="meta-page-state">{error}</p>;
  if (!data) return <p className="meta-page-state">포메이션과 팀컬러 랭킹을 불러오고 있습니다.</p>;
  return activeTab === "formations"
    ? <MetaRankingSection id="formations" kicker="FORMATION RANKING" title="포메이션 랭킹" description={`${data.formations.sampleSize.toLocaleString()}명의 실제 선발 포지션 기준`} items={data.formations.items} formation />
    : <MetaRankingSection id="team-colors" kicker="TEAM COLOR RANKING" title="팀컬러 랭킹" description={`${data.teamColors.sampleSize.toLocaleString()}명의 대표 팀컬러 기준`} items={data.teamColors.items} />;
}

