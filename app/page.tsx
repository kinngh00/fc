"use client";

import { FormEvent, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CommunityPreview } from "./community";
import { SiteHeader, SiteFooter } from "./site-chrome";
import { trackAnalytics } from "./analytics";
import { MetaRankingContent, type MetaTab } from "./meta-ranking";

type PickItem = {
  spid: string;
  pid: string;
  seasonId: number;
  season: string | null;
  seasonImage: string | null;
  name: string | null;
  grade: number;
  position: string;
  count: number;
  pickRate: number;
  adaptation: number;
  ovr: number | null;
  price: string | null;
};

type PickResponse = {
  snapshot: { id: number; data_time: string; completed_at: string };
  matchingManagers: number;
  positionTotal: number;
  totalItems: number;
  items: PickItem[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type PlayerDetail = {
  spid: string;
  grade: number;
  name: string;
  season: string | null;
  seasonImage: string | null;
  image: string | null;
  ovr: number | null;
  pay: number | null;
  positions: Array<{ position: string; value: number }>;
  birthDate: string | null;
  height: string | null;
  weight: string | null;
  bodyType: string | null;
  skillMoves: string | null;
  foot: string | null;
  footStrong: string | null;
  nation: string | null;
  nationImage: string | null;
  traits: Array<{ name: string; image: string }>;
  abilities: Array<{ name: string; value: number }>;
  teamColors: Array<{ label: string; items: string[] }>;
  career?: Array<{ year: string; club: string; loan: string | null }>;
  market?: { currentPrice: string | null; history: Array<{ date: string; price: string }> };
};

type Query = { start: string; end: string; team: string; position: string; detailed: boolean; adaptation: number };

type RankingItem = {
  rank: number;
  nickname: string;
  nexonSn: string;
  level: number | null;
  clubValue: string | null;
  elo: number | null;
  winRate: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  primaryTeamColor: string | null;
  teamImage: string | null;
  teamColorCount: number | null;
  formation: string | null;
  lineupStatus: string;
  previousRank: number | null;
  previousClubValue: string | null;
  previousWinRate: number | null;
};

type RankingResponse = {
  snapshot: { id: number; data_time: string };
  total: number;
  items: RankingItem[];
  offset: number;
  limit: number;
  hasMore: boolean;
};
type HomeInsightItem = { name: string; count: number; rate: number; image?: string | null };
type HomeInsightsResponse = {
  snapshot: { id: number; data_time: string } | null;
  formations: { sampleSize: number; items: HomeInsightItem[] };
  teamColors: { sampleSize: number; items: HomeInsightItem[] };
};

type HistoryItem = { dataTime: string; rank: number; clubValue: string; winRate: number | null };
type HistoryFrame = "hour" | "day" | "week";
type HistoryChange = { label: string; trend: "up" | "down" | "same" };
type SquadItem = { slot: number; spid: string; grade: number; position: string | null; name: string | null; season: string | null; seasonImage: string | null };
type PlayerTeamColor = { id: string; name: string; image: string } | null;
type SquadProfileDetails = {
  formation: string | null;
  adaptation: number;
  sourceKind?: "latest-manager-match";
  sourceMatchId?: string | null;
  players: Array<{ spid: string; name: string | null; position: string | null; grade: number; season: string | null; seasonImage: string | null; image: string | null; ovr: number | null; pay: number | null; price: string | null; nationId: string | null; nationName: string | null; nationImage: string | null; affiliationTeamColor: PlayerTeamColor; featureTeamColor: PlayerTeamColor; x: number; y: number }>;
  coach: { id: string; name: string; image: string | null; description: string | null; abilities: string[]; formations: string[] } | null;
  teamColors: Array<{ id: string; category: string; categoryLabel: string; level: number; name: string; effects: string[]; image: string | null; playerCount: number; playerSpids: string[] }>;
};
type UserProfileResponse = {
  snapshot: { id: number; data_time: string };
  profile: RankingItem & { hasOuid: boolean };
  history: HistoryItem[];
  squad: SquadItem[];
};
type LiveUserResponse = {
  source: "nexon-live";
  nickname: string;
  ouid: string;
  level: number | null;
  nexonSn: string | null;
  squad: { totalPrice?: number; totalPay?: number; players?: Array<{ spid?: number; name?: string }> } | null;
  managerRecord: { wins: number; draws: number; losses: number; winRate: number } | null;
  maxDivision: { matchType: number; division: number; divisionName: string; divisionImage: string | null; achievementDate: string } | null;
};
type MatchParticipant = {
  nickname: string | null; result: string | null; score: number; possession: number;
  shots: number; effectiveShots: number; passTry: number; passSuccess: number;
  fouls: number; corners: number; yellowCards: number; redCards: number;
};
type MatchItem = {
  matchId: string; matchDate: string; self: MatchParticipant | null; opponent: MatchParticipant | null;
  players: { self: SquadItem[]; opponent: SquadItem[] };
};

const positionPriority = [
  "LW", "LS", "ST", "RS", "RW", "LF", "CF", "RF",
  "LAM", "CAM", "RAM", "LM", "LCM", "CM", "RCM", "RM",
  "LDM", "CDM", "RDM", "LWB", "LB", "LCB", "CB", "RCB", "RB", "RWB", "SW", "GK",
];
const attackingPositions = new Set(["ST", "LS", "RS", "LW", "LF", "CF", "RF", "RW"]);
const midfieldPositions = new Set(["CAM", "LAM", "RAM", "LM", "LCM", "CM", "RCM", "RM", "LDM", "CDM", "RDM"]);

function positionGroup(position: string | null) {
  if (position && attackingPositions.has(position)) return "attack";
  if (position && midfieldPositions.has(position)) return "midfield";
  return "defense";
}
function orderedSquad(items: SquadItem[]) {
  return [...items].sort((left, right) => {
    const leftIndex = positionPriority.indexOf(left.position || "");
    const rightIndex = positionPriority.indexOf(right.position || "");
    const normalizedLeft = leftIndex === -1 ? positionPriority.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? positionPriority.length : rightIndex;
    return normalizedLeft - normalizedRight || left.slot - right.slot;
  });
}
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";
const managerSearchDraftKey = "fc-support:manager-search-draft";
const managerSearchDraftSourceKey = "fc-support:manager-search-draft-source";
const formationViewStorageKey = "fc-support:formation-view";
const formationViewChangeEvent = "fc-support:formation-view-change";
const rankingPageSize = 20;

function seasonLabel(season: string | null) {
  return season?.split(" ")[0] || "시즌 정보 없음";
}

function snapshotLabel(value?: string) {
  if (!value) return "수집 데이터 없음";
  return value.replace("T", " ").replace("+09:00", " KST");
}

function simpleSnapshotLabel(value?: string) {
  if (!value) return "시간 정보 없음";
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]} 기준` : "시간 정보 없음";
}

function integerLabel(value: string | number | null | undefined, minimumIntegerDigits = 1) {
  return Number(value || 0).toLocaleString("ko-KR", { minimumIntegerDigits });
}

function historyBucket(dataTime: string, frame: HistoryFrame) {
  const date = new Date(dataTime);
  if (frame === "hour") return dataTime.slice(0, 13);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  if (frame === "day") return kst.toISOString().slice(0, 10);
  const day = kst.getUTCDay() || 7;
  kst.setUTCDate(kst.getUTCDate() - day + 1);
  return kst.toISOString().slice(0, 10);
}

function aggregateHistory(items: HistoryItem[], frame: HistoryFrame) {
  if (frame === "hour") return items;
  const buckets = new Map<string, HistoryItem>();
  for (const item of items) buckets.set(historyBucket(item.dataTime, frame), item);
  return [...buckets.values()];
}

function historyTooltipLabel(value: string | undefined) {
  if (!value) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function clubValueLabel(value: string | null) {
  if (!value) return "정보 없음";
  const amount = BigInt(value);
  const gyeong = amount / 10_000_000_000_000_000n;
  const jo = (amount % 10_000_000_000_000_000n) / 1_000_000_000_000n;
  const eok = (amount % 1_000_000_000_000n) / 100_000_000n;
  if (gyeong > 0n) return `${gyeong.toLocaleString()}경 ${jo.toLocaleString()}조`;
  if (jo > 0n) return `${jo.toLocaleString()}조`;
  if (eok > 0n) return `${eok.toLocaleString()}억`;
  return amount.toLocaleString("ko-KR");
}

function clubValueChangeLabel(amount: bigint) {
  const absolute = amount < 0n ? -amount : amount;
  const gyeong = absolute / 10_000_000_000_000_000n;
  const jo = (absolute % 10_000_000_000_000_000n) / 1_000_000_000_000n;
  const eok = (absolute % 1_000_000_000_000n) / 100_000_000n;
  if (gyeong > 0n) return `${gyeong.toLocaleString()}경 ${jo.toLocaleString()}조`;
  if (jo > 0n) return `${jo.toLocaleString()}조 ${eok.toLocaleString()}억`;
  if (eok > 0n) return `${eok.toLocaleString()}억`;
  return absolute.toLocaleString("ko-KR");
}

function squadPriceLabel(value: string | null) {
  const digits = value?.replace(/[^0-9]/g, "") || "";
  return digits ? clubValueLabel(digits) : "가격 정보 없음";
}

function historyClubValueLabel(value: number) {
  return clubValueLabel(String(BigInt(Math.round(value * 10)) * 10_000_000n));
}

function historyClubValuePoint(value: string) {
  return Number(BigInt(value) / 10_000_000n) / 10;
}

function RankingDelta({ direction, label, unavailable = false }: {
  direction: "up" | "down" | "same";
  label: string;
  unavailable?: boolean;
}) {
  if (!unavailable && direction === "same") return null;
  return <small className={`ranking-delta trend-${unavailable ? "unavailable" : direction}`}>
    {unavailable ? "이전 기록 없음" : direction === "up" ? `▲ ${label}` : direction === "down" ? `▼ ${label}` : "변동 없음"}
  </small>;
}

function RankDelta({ current, previous }: { current: number; previous: number | null }) {
  if (previous == null) return <RankingDelta direction="same" label="" unavailable />;
  const difference = previous - current;
  return <RankingDelta direction={difference > 0 ? "up" : difference < 0 ? "down" : "same"} label={Math.abs(difference).toLocaleString()} />;
}

function ClubValueDelta({ current, previous }: { current: string | null; previous: string | null }) {
  if (current == null || previous == null) return <RankingDelta direction="same" label="" unavailable />;
  const difference = BigInt(current) - BigInt(previous);
  return <RankingDelta direction={difference > 0n ? "up" : difference < 0n ? "down" : "same"} label={clubValueChangeLabel(difference)} />;
}

function WinRateDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return <RankingDelta direction="same" label="" unavailable />;
  const difference = current - previous;
  return <RankingDelta direction={difference > 0 ? "up" : difference < 0 ? "down" : "same"} label={`${Math.abs(difference).toFixed(1)}%p`} />;
}

function rankHistoryChange(first: HistoryItem, last: HistoryItem): HistoryChange {
  const difference = first.rank - last.rank;
  if (difference > 0) return { label: `${difference.toLocaleString()}등 상승`, trend: "up" };
  if (difference < 0) return { label: `${Math.abs(difference).toLocaleString()}등 하락`, trend: "down" };
  return { label: "랭킹 변동 없음", trend: "same" };
}

function clubValueHistoryChange(first: HistoryItem, last: HistoryItem): HistoryChange {
  const difference = BigInt(last.clubValue) - BigInt(first.clubValue);
  if (difference > 0n) return { label: `${clubValueChangeLabel(difference)} 상승`, trend: "up" };
  if (difference < 0n) return { label: `${clubValueChangeLabel(difference)} 하락`, trend: "down" };
  return { label: "구단가치 변동 없음", trend: "same" };
}

function winRateHistoryChange(first: HistoryItem, last: HistoryItem): HistoryChange {
  const difference = Number(((last.winRate ?? 0) - (first.winRate ?? 0)).toFixed(1));
  if (difference > 0) return { label: `${difference.toFixed(1)}%p 상승`, trend: "up" };
  if (difference < 0) return { label: `${Math.abs(difference).toFixed(1)}%p 하락`, trend: "down" };
  return { label: "승률 변동 없음", trend: "same" };
}

function paginationItems(current: number, total: number) {
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

function TeamAutocomplete({ id, label, value, options, onChange, onSelect, clearable = false, onClear }: {
  id: string; label: string; value: string; options: string[]; onChange: (value: string) => void; onSelect?: (value: string) => void; clearable?: boolean; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = value.trim().toLocaleLowerCase("ko-KR");
  const matches = options
    .filter((option) => !normalized || option.toLocaleLowerCase("ko-KR").startsWith(normalized));
  return (
    <div className={`autocomplete-field ${clearable && value ? "has-clear" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} role="combobox" aria-controls={`${id}-options`} aria-expanded={open} autoComplete="off" value={value} placeholder="전체 팀" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} />
      {clearable && value && <button className="autocomplete-clear" type="button" aria-label={`${label} 지우기`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setOpen(false); onClear?.(); }}>×</button>}
      {open && matches.length > 0 && <div className="autocomplete-menu" id={`${id}-options`} role="listbox">
        {!normalized && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); onSelect?.(""); setOpen(false); }}>전체 팀</button>}
        {matches.map((option) => <button type="button" role="option" aria-selected={value === option} key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); onSelect?.(option); setOpen(false); }}>{option}</button>)}
      </div>}
    </div>
  );
}

function NicknameAutocomplete({ id, label, value, onChange, clearable = false, onClear }: {
  id: string; label: string; value: string; onChange: (value: string) => void; clearable?: boolean; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ nickname: string; rank: number }>>([]);
  useEffect(() => {
    const prefix = value.trim();
    if (!open || !prefix) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ prefix });
      void fetch(`${apiBaseUrl}/api/users/suggestions?${parameters}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((payload) => setSuggestions(Array.isArray(payload.items) ? payload.items : []))
        .catch(() => setSuggestions([]));
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, value]);
  return (
    <div className={`autocomplete-field nickname-autocomplete ${clearable && value ? "has-clear" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} role="combobox" aria-controls={`${id}-options`} aria-expanded={open} autoComplete="off" value={value} placeholder="닉네임 입력" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { onChange(event.target.value); if (!event.target.value.trim()) setSuggestions([]); setOpen(true); }} />
      {clearable && value && <button className="autocomplete-clear" type="button" aria-label={`${label} 지우기`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setSuggestions([]); setOpen(false); onClear?.(); }}>×</button>}
      {open && suggestions.length > 0 && <div className="autocomplete-menu" id={`${id}-options`} role="listbox">
        {suggestions.map((item) => <button type="button" role="option" aria-selected={value === item.nickname} key={`${item.rank}-${item.nickname}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(item.nickname); setOpen(false); }}><span>{item.nickname}</span><small>{item.rank.toLocaleString()}위</small></button>)}
      </div>}
    </div>
  );
}

function HistoryFrameToggle({ value, onChange }: { value: HistoryFrame; onChange: (frame: HistoryFrame) => void }) {
  return <div className="history-frame-toggle" aria-label="차트 조회 단위">
    {([['hour', '1시간봉'], ['day', '일봉'], ['week', '주봉']] as const).map(([frame, label]) => <button type="button" className={value === frame ? "active" : ""} aria-pressed={value === frame} key={frame} onClick={() => onChange(frame)}>{label}</button>)}
  </div>;
}

function PlayerImage({ spid, name, wrapperClassName = "" }: {
  spid: string; name: string; directImage?: string | null; wrapperClassName?: string; preserveSpace?: boolean;
}) {
  const [source, setSource] = useState<"spid" | "pid" | "missing">("spid");
  const pid = spid.slice(-6).replace(/^0+/, "") || "0";
  const playerId = source === "spid" ? spid : pid;
  const content = source === "missing" ? null : <img
    alt={`${name} 선수 이미지`}
    src={`https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${playerId}.png`}
    onError={() => setSource((current) => current === "spid" ? "pid" : "missing")}
  />;
  return wrapperClassName ? <div className={`${wrapperClassName} ${source === "missing" ? "missing" : ""}`}>{content}</div> : content;
}

function SeasonBadge({ season, image }: { season: string | null; image: string | null }) {
  const label = season || "시즌 정보 없음";
  const tooltip = seasonLabel(season);
  return (
    <span className="season-badge player-meta-badge" data-tooltip={tooltip} title={tooltip} tabIndex={0}>
      {image ? <img src={image} alt={`${label} 시즌`} /> : <span>{seasonLabel(season)}</span>}
    </span>
  );
}

function enhancementStyle(grade: number) {
  return grade <= 1 ? "gray" : grade <= 4 ? "copper" : grade <= 7 ? "silver" : grade <= 10 ? "gold" : "platinum";
}

function EnhancementBadge({ grade }: { grade: number }) {
  const style = enhancementStyle(grade);
  return <span className={`enhancement-badge enhancement-${style} player-meta-badge`} aria-label={`${grade}카`} data-tooltip={`${grade}카`} title={`${grade}카`} tabIndex={0}>+{grade}</span>;
}

function TeamColorBadge({ color, label }: { color: PlayerTeamColor; label: "소속 팀컬러" | "특성 팀컬러" }) {
  if (!color) return null;
  const tooltip = color.name;
  return <span className="player-meta-badge team-color-badge" data-tooltip={tooltip} title={tooltip} tabIndex={0}><img src={color.image} alt={`${color.name} ${label}`} /></span>;
}

function NationBadge({ name, image }: { name: string | null; image: string | null }) {
  if (!name || !image) return null;
  const tooltip = name;
  return <span className="player-meta-badge nation-badge" data-tooltip={tooltip} title={tooltip} tabIndex={0}><img src={image} alt={`${name} 국기`} /></span>;
}

function PlayerMetaBadges({ player }: { player: SquadProfileDetails["players"][number] }) {
  return <>
    <EnhancementBadge grade={player.grade} />
    <SeasonBadge season={player.season} image={player.seasonImage} />
    <TeamColorBadge color={player.featureTeamColor} label="특성 팀컬러" />
    <NationBadge name={player.nationName} image={player.nationImage} />
  </>;
}

function CompactSwitch({ label, checked, onChange, disabled = false, showStateText = true }: {
  label: string; checked: boolean; onChange: () => void; disabled?: boolean; showStateText?: boolean;
}) {
  return <button className={`compact-switch ${checked ? "active" : ""}`} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}>
    <span>{label}</span><i aria-hidden="true"><em /></i>{showStateText && <b>{checked ? "ON" : "OFF"}</b>}
  </button>;
}

function FormationPitch({ details, fallbackFormation }: { details: SquadProfileDetails; fallbackFormation: string | null }) {
  const desiredPositions: Record<string, { left: number; bottom: number; line: number }> = {
    GK: { left: 50, bottom: 6, line: 0 }, SW: { left: 50, bottom: 24, line: 1 },
    LWB: { left: 8, bottom: 30, line: 1 }, LB: { left: 12, bottom: 27, line: 1 }, LCB: { left: 35, bottom: 30, line: 1 },
    CB: { left: 50, bottom: 29, line: 1 }, RCB: { left: 65, bottom: 30, line: 1 }, RB: { left: 88, bottom: 27, line: 1 }, RWB: { left: 92, bottom: 30, line: 1 },
    LDM: { left: 35, bottom: 48, line: 2 }, CDM: { left: 50, bottom: 47, line: 2 }, RDM: { left: 65, bottom: 48, line: 2 },
    LM: { left: 13, bottom: 53, line: 2 }, LCM: { left: 35, bottom: 54, line: 2 }, CM: { left: 50, bottom: 54, line: 2 }, RCM: { left: 65, bottom: 54, line: 2 }, RM: { left: 87, bottom: 53, line: 2 },
    LAM: { left: 27, bottom: 70, line: 3 }, CAM: { left: 50, bottom: 73, line: 3 }, RAM: { left: 73, bottom: 70, line: 3 },
    LW: { left: 12, bottom: 86, line: 4 }, LF: { left: 29, bottom: 84, line: 4 }, LS: { left: 38, bottom: 88, line: 4 },
    ST: { left: 50, bottom: 89, line: 4 }, RS: { left: 62, bottom: 88, line: 4 }, RF: { left: 71, bottom: 84, line: 4 }, RW: { left: 88, bottom: 86, line: 4 }, CF: { left: 50, bottom: 84, line: 4 },
  };
  const layout = new Map<string, { left: number; bottom: number; rowCount: number }>();
  const lineCounts = new Map<number, number>();
  const nodes = details.players.map((player, index) => {
    const desired = desiredPositions[player.position || ""] || { left: 50, bottom: 54, line: 2 };
    lineCounts.set(desired.line, (lineCounts.get(desired.line) || 0) + 1);
    return { player, index, desired, left: desired.left, bottom: desired.bottom };
  });
  for (let iteration = 0; iteration < 48; iteration += 1) {
    nodes.forEach((node) => {
      node.left += (node.desired.left - node.left) * 0.025;
      node.bottom += (node.desired.bottom - node.bottom) * 0.025;
    });
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const leftNode = nodes[leftIndex];
        const rightNode = nodes[rightIndex];
        const denseLine = Math.max(lineCounts.get(leftNode.desired.line) || 1, lineCounts.get(rightNode.desired.line) || 1);
        const minimumX = denseLine >= 5 ? 18 : 22;
        const minimumY = 19;
        const deltaX = rightNode.left - leftNode.left;
        const deltaY = rightNode.bottom - leftNode.bottom;
        const overlapX = minimumX - Math.abs(deltaX);
        const overlapY = minimumY - Math.abs(deltaY);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const direction = deltaX === 0 ? (rightNode.index > leftNode.index ? 1 : -1) : Math.sign(deltaX);
          const shift = overlapX / 2 + 0.35;
          leftNode.left -= direction * shift;
          rightNode.left += direction * shift;
        } else {
          const direction = deltaY === 0 ? (rightNode.index > leftNode.index ? 1 : -1) : Math.sign(deltaY);
          const shift = overlapY / 2 + 0.35;
          leftNode.bottom -= direction * shift;
          rightNode.bottom += direction * shift;
        }
      }
    }
    nodes.forEach((node) => {
      node.left = Math.max(10, Math.min(90, node.left));
      node.bottom = Math.max(5, Math.min(87, node.bottom));
    });
  }
  nodes.forEach((node) => {
    layout.set(`${node.player.spid}-${node.player.position}`, {
      left: node.left,
      bottom: node.bottom,
      rowCount: lineCounts.get(node.desired.line) || 1,
    });
  });
  return <div className="formation-view">
    <div className="formation-view-title"><span>FORMATION</span><b>{details.formation || fallbackFormation || "포메이션 정보 없음"}</b></div>
    <div className="formation-pitch">
      <div className="pitch-halfway" /><div className="pitch-circle" /><div className="pitch-box pitch-box-top" /><div className="pitch-box pitch-box-bottom" />
      {details.players.map((player) => {
        const position = layout.get(`${player.spid}-${player.position}`) || { left: 50, bottom: 46, rowCount: 1 };
        return (
        <article
          className={`formation-player position-${positionGroup(player.position)}`}
          key={`${player.spid}-${player.position}`}
          style={{
            left: `${position.left}%`,
            bottom: `${position.bottom}%`,
            "--mobile-player-left": `${position.left}%`,
            "--mobile-player-bottom": `${position.bottom}%`,
            "--formation-row-count": position.rowCount,
          } as CSSProperties}
        >
          <div className="formation-player-heading"><b>{player.position || "—"}</b></div>
          <PlayerImage spid={player.spid} name={player.name || "선수"} directImage={player.image} wrapperClassName="formation-player-image" />
          <div className="formation-player-name"><b title={player.name || "선수명 정보 없음"}>{player.name || "선수명 정보 없음"}</b>{player.ovr != null && <strong>{`OVR ${player.ovr}`}</strong>}</div>
          <div className="formation-player-meta"><PlayerMetaBadges player={player} /></div>
          <div className="formation-player-price"><span>{player.pay == null ? "급여 정보 없음" : `급여 ${player.pay}`}</span><b>{squadPriceLabel(player.price)}</b></div>
        </article>
        );
      })}
    </div>
  </div>;
}

function SquadSupportDetails({ details }: { details: SquadProfileDetails }) {
  const [hoveredTeamColor, setHoveredTeamColor] = useState<string | null>(null);
  const [coachImageFailed, setCoachImageFailed] = useState(false);
  const [defaultCoachImageFailed, setDefaultCoachImageFailed] = useState(false);
  const defaultCoachImage = "https://ssl.nexon.com/s2/game/fc/mobile/squadMaker/default/d_coach.png";
  useEffect(() => {
    setCoachImageFailed(false);
    setDefaultCoachImageFailed(false);
  }, [details.coach?.image]);
  return <div className="squad-support-details">
    <section className="squad-coach-card">
      <div className="squad-detail-heading"><h4>감독</h4></div>
      {details.coach ? <div className="coach-content">
        {!defaultCoachImageFailed ? <img
          src={details.coach.image && !coachImageFailed ? details.coach.image : defaultCoachImage}
          alt={`${details.coach.name} 감독`}
          onError={() => details.coach?.image && !coachImageFailed ? setCoachImageFailed(true) : setDefaultCoachImageFailed(true)}
        /> : <span className="coach-image-missing">감독 이미지</span>}
        <div><h5>{details.coach.name}</h5>{details.coach.description && <p>{details.coach.description}</p>}
          <dl><div><dt>효과</dt><dd>{details.coach.abilities.length ? details.coach.abilities.join(" · ") : "효과 정보 없음"}</dd></div><div><dt>선호 포메이션</dt><dd>{details.coach.formations.length ? details.coach.formations.join(" | ") : "정보 없음"}</dd></div></dl>
        </div>
      </div> : <p className="squad-detail-empty">등록된 감독 정보가 없습니다.</p>}
    </section>
    <section className="squad-team-colors">
      <div className="squad-detail-heading"><h4>적용 팀컬러</h4></div>
      {details.teamColors.length ? <div className="team-color-detail-list">{details.teamColors.map((color) => {
        const colorKey = `${color.category}-${color.id}-${color.name}`;
        const playerSpids = new Set(color.playerSpids.map(String));
        const appliedPlayers = details.players.filter((player) => {
          if (playerSpids.size) return playerSpids.has(String(player.spid));
          if (color.category === "affiliation") return player.affiliationTeamColor?.id === color.id || player.affiliationTeamColor?.name === color.name;
          if (color.category === "feature") return player.featureTeamColor?.id === color.id || player.featureTeamColor?.name === color.name;
          return false;
        });
        const appliedPlayerNames = appliedPlayers.map((player) => player.name || "선수명 정보 없음");
        return <article key={colorKey} onMouseEnter={() => setHoveredTeamColor(colorKey)} onMouseLeave={() => setHoveredTeamColor(null)}>
          {color.image ? <img src={color.image} alt="" /> : <span className="team-color-image-missing" />}
          <div><small>{color.categoryLabel} · LV.{color.level} · {color.playerCount}명</small><b>{color.name}</b><p>{color.effects.length ? color.effects.join(" · ") : "효과 정보 없음"}</p></div>
          <div className={`team-color-applied-tooltip ${hoveredTeamColor === colorKey ? "visible" : ""}`}><span>적용 선수</span><p>{appliedPlayerNames.length ? appliedPlayerNames.join(" · ") : "적용 선수 정보 없음"}</p></div>
        </article>;
      })}</div> : <p className="squad-detail-empty">적용 중인 팀컬러 정보가 없습니다.</p>}
    </section>
  </div>;
}

function SquadSection({ nickname, formation, squad, emptyClassName = "profile-empty" }: {
  nickname: string; formation: string | null; squad: SquadItem[]; emptyClassName?: string;
}) {
  const [formationView, setFormationView] = useState(false);
  const [details, setDetails] = useState<SquadProfileDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const restoreFormationView = () => setFormationView(window.localStorage.getItem(formationViewStorageKey) === "on");
    const syncFormationView = (event: Event) => setFormationView(Boolean((event as CustomEvent<boolean>).detail));
    const syncStoredFormationView = (event: StorageEvent) => {
      if (event.key === formationViewStorageKey) restoreFormationView();
    };
    restoreFormationView();
    window.addEventListener(formationViewChangeEvent, syncFormationView);
    window.addEventListener("storage", syncStoredFormationView);
    return () => {
      window.removeEventListener(formationViewChangeEvent, syncFormationView);
      window.removeEventListener("storage", syncStoredFormationView);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setDetails(null);
    const parameters = new URLSearchParams({ nickname });
    void fetch(`${apiBaseUrl}/api/users/squad-details?${parameters}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "스쿼드 상세 정보를 불러오지 못했습니다.");
        setDetails(payload.profile || null);
      })
      .catch((requestError) => { if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "스쿼드 상세 정보를 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [nickname]);

  const detailedSquad = details ? [...details.players].sort((left, right) => {
    const leftIndex = positionPriority.indexOf(left.position || "");
    const rightIndex = positionPriority.indexOf(right.position || "");
    return (leftIndex === -1 ? positionPriority.length : leftIndex) - (rightIndex === -1 ? positionPriority.length : rightIndex);
  }) : [];

  const toggleFormationView = () => {
    const next = !formationView;
    window.localStorage.setItem(formationViewStorageKey, next ? "on" : "off");
    window.dispatchEvent(new CustomEvent<boolean>(formationViewChangeEvent, { detail: next }));
  };

  return <>
    <div className="profile-block-heading"><div><h3>현재 선발 스쿼드</h3><small className="squad-adaptation-note">모든 선수는 적응도 5로 표시됩니다.</small></div><div className="squad-heading-tools"><b>{details?.players.length ?? squad.length}명</b><CompactSwitch label="포메이션 배치" checked={formationView} disabled={loading || !details?.players.length} onChange={toggleFormationView} /></div></div>
    {formationView && details ? <FormationPitch details={details} fallbackFormation={formation} /> : detailedSquad.length > 0 ? <>
      <div className="squad-list-formation"><span>FORMATION</span><b>{details?.formation || formation || "포메이션 정보 없음"}</b></div>
      <div className="squad-grid squad-grid-detailed">{detailedSquad.map((player) => (
        <article className={`position-${positionGroup(player.position)}`} key={`${player.spid}-${player.position}`}>
          <div className="squad-card-heading"><b>{player.position || "—"}</b></div>
          <PlayerImage spid={player.spid} name={player.name || "선수"} directImage={player.image} wrapperClassName="squad-card-image" />
          <b className="squad-card-name" title={player.name || "선수명 정보 없음"}>{player.name || "선수명 정보 없음"}</b>
          {player.ovr != null && <strong className="squad-card-ovr">{`OVR ${player.ovr}`}</strong>}
          <div className="squad-card-meta"><PlayerMetaBadges player={player} /></div>
          <div className="squad-card-price"><span>{player.pay == null ? "급여 정보 없음" : `급여 ${player.pay}`}</span><b>{squadPriceLabel(player.price)}</b></div>
        </article>
      ))}</div>
    </> : loading ? <div className={emptyClassName}>현재 선발 스쿼드를 불러오고 있습니다.</div> : <div className={emptyClassName}>저장된 선발 스쿼드가 없습니다.</div>}
    {loading ? <div className="squad-detail-loading">감독과 팀컬러 정보를 확인하고 있습니다.</div> : error ? <div className="squad-detail-loading error">{error}</div> : details ? <SquadSupportDetails details={details} /> : null}
  </>;
}

function HistoryChart({ title, items, value, format, formatPoint, frame, change, lowerIsHigher = false, visibleScale = false, scalePaddingRatio = 0.18, minimumScalePadding = 0 }: {
  title: string;
  items: HistoryItem[];
  value: (item: HistoryItem) => number | null;
  format: (item: HistoryItem) => string;
  formatPoint: (point: number) => string;
  frame: HistoryFrame;
  change: (first: HistoryItem, last: HistoryItem) => HistoryChange;
  lowerIsHigher?: boolean;
  visibleScale?: boolean;
  scalePaddingRatio?: number;
  minimumScalePadding?: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [visibleWindow, setVisibleWindow] = useState({ left: 0, width: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const chartItems = items.map((item) => ({ item, point: value(item) }))
    .filter((entry): entry is { item: HistoryItem; point: number } => entry.point != null && Number.isFinite(entry.point));
  const points = chartItems.map((entry) => entry.point);
  const syncVisibleWindow = (scroller: HTMLDivElement) => {
    const next = { left: scroller.scrollLeft, width: scroller.clientWidth };
    setVisibleWindow((current) => current.left === next.left && current.width === next.width ? current : next);
  };
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollLeft = scroller.scrollWidth;
    syncVisibleWindow(scroller);
    const resizeObserver = new ResizeObserver(() => syncVisibleWindow(scroller));
    resizeObserver.observe(scroller);
    return () => resizeObserver.disconnect();
  }, [items, frame]);
  if (points.length < 2) return <div className="history-chart empty"><h4>{title}</h4><p>변화를 보여줄 기록이 아직 부족합니다.</p></div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const plotHeight = 140;
  const pointSpacing = 56;
  const plotWidth = Math.max(300, 16 + (points.length - 1) * pointSpacing);
  const viewportLeft = visibleWindow.width > 0 ? visibleWindow.left : Math.max(0, plotWidth - 320);
  const viewportWidth = visibleWindow.width > 0 ? visibleWindow.width : Math.min(320, plotWidth);
  const visibleStart = Math.max(0, Math.min(points.length - 1, Math.ceil((viewportLeft - 8) / pointSpacing)));
  const visibleEnd = Math.max(visibleStart, Math.min(points.length - 1, Math.floor((viewportLeft + viewportWidth - 8) / pointSpacing)));
  const visiblePoints = visibleScale ? points.slice(visibleStart, visibleEnd + 1) : points;
  const visibleMin = Math.min(...visiblePoints);
  const visibleMax = Math.max(...visiblePoints);
  const visibleRange = visibleMax - visibleMin;
  const scalePadding = Math.max(minimumScalePadding, visibleRange * scalePaddingRatio);
  const scaleMin = visibleScale ? visibleMin - scalePadding : min;
  const scaleMax = visibleScale ? visibleMax + scalePadding : max;
  const coordinates = chartItems.map(({ point }, index) => {
    const x = 8 + (index / Math.max(points.length - 1, 1)) * (plotWidth - 16);
    const ratio = scaleMax === scaleMin ? 0.5 : (point - scaleMin) / (scaleMax - scaleMin);
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const y = scaleMax === scaleMin ? 70 : lowerIsHigher ? 20 + clampedRatio * 110 : 130 - clampedRatio * 110;
    return { x, y };
  });
  const active = activeIndex == null ? null : chartItems[activeIndex];
  const activeCoordinate = activeIndex == null ? null : coordinates[activeIndex];
  const line = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const changeResult = change(chartItems[0].item, chartItems.at(-1)!.item);
  const highest = lowerIsHigher ? min : max;
  const lowest = lowerIsHigher ? max : min;
  const average = points.reduce((sum, point) => sum + point, 0) / points.length;
  const finishDrag = (element: HTMLDivElement, pointerId: number) => {
    dragRef.current.active = false;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  };
  return <div className="history-chart" data-frame={frame}>
    <div><h4>{title}</h4><strong>{format(chartItems.at(-1)!.item)}</strong></div>
    <div
      className="history-chart-scroll"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragRef.current = { active: true, moved: false, startX: event.clientX, startLeft: event.currentTarget.scrollLeft };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current.active) return;
        const distance = event.clientX - dragRef.current.startX;
        if (Math.abs(distance) > 3) dragRef.current.moved = true;
        event.currentTarget.scrollLeft = dragRef.current.startLeft - distance;
      }}
      onPointerUp={(event) => finishDrag(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finishDrag(event.currentTarget, event.pointerId)}
      onScroll={(event) => syncVisibleWindow(event.currentTarget)}
      onWheel={(event) => {
        event.preventDefault();
        event.currentTarget.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      }}
      ref={scrollRef}
      role="region"
      aria-label={`${title} 이전 기록 탐색`}
      tabIndex={0}
    >
      <div className="history-chart-plot" onMouseLeave={() => setActiveIndex(null)} style={{ width: `${plotWidth}px`, height: `${plotHeight + 20}px` }}>
        <svg viewBox={`0 0 ${plotWidth} ${plotHeight}`} role="img" aria-label={`${title} 변화`} style={{ width: `${plotWidth}px`, height: `${plotHeight}px` }}>
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {coordinates.map(({ x, y }, index) => {
            const label = `${historyTooltipLabel(chartItems[index].item.dataTime)}, ${format(chartItems[index].item)}`;
            return <g key={`${chartItems[index].item.dataTime}-${index}`}>
              <circle
              className={activeIndex === index ? "active" : ""}
              cx={x}
              cy={y}
              fill="currentColor"
              onBlur={() => setActiveIndex(null)}
              onClick={() => { if (!dragRef.current.moved) setActiveIndex(index); }}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => { if (!dragRef.current.active) setActiveIndex(index); }}
              r={activeIndex === index ? 5 : 3.5}
              role="button"
              tabIndex={0}
              aria-label={label}
              />
            </g>;
          })}
        </svg>
        {active && activeCoordinate && <div
          className={`history-chart-tooltip ${activeCoordinate.y < 60 ? "below" : ""}`}
          style={{
            left: `${Math.min(plotWidth - 72, Math.max(72, activeCoordinate.x))}px`,
            top: `${(activeCoordinate.y / plotHeight) * 100}%`,
          }}
        ><span>{historyTooltipLabel(active.item.dataTime)}</span><b>{format(active.item)}</b></div>}
      </div>
    </div>
    <div className="history-chart-stats">
      <span>최고 <b>{formatPoint(highest)}</b></span>
      <span>최저 <b>{formatPoint(lowest)}</b></span>
      <span>평균 <b>{formatPoint(average)}</b></span>
    </div>
    <div className={`history-chart-change trend-${changeResult.trend}`}><span>{title}</span><b>{changeResult.label}</b></div>
  </div>;
}

const adsenseClient = "ca-pub-1436343908093854";
const responsiveAdSlot = "9658268635";

function ResponsiveAd({ label }: { label: string }) {
  const adRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const ad = adRef.current;
    if (!ad || ad.dataset.adRequested === "true") return;

    ad.dataset.adRequested = "true";
    try {
      const adsenseWindow = window as typeof window & { adsbygoogle?: unknown[] };
      adsenseWindow.adsbygoogle = adsenseWindow.adsbygoogle || [];
      adsenseWindow.adsbygoogle.push({});
    } catch {
      delete ad.dataset.adRequested;
    }
  }, [mounted]);

  return (
    <aside className="responsive-ad" aria-label={label}>
      {mounted && <ins
        ref={adRef}
        className="adsbygoogle"
        data-ad-client={adsenseClient}
        data-ad-slot={responsiveAdSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />}
    </aside>
  );
}

export function PlayerMarketChart({ market, marketRef }: { market: PlayerDetail["market"]; marketRef?: RefObject<HTMLElement | null> }) {
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const history = (market?.history || []).slice(-30);
  const values = history.map((item) => Number(item.price));
  const exactValues = history.map((item) => BigInt(item.price));
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const exactMinimum = exactValues.length ? exactValues.reduce((lowest, value) => value < lowest ? value : lowest) : 0n;
  const exactMaximum = exactValues.length ? exactValues.reduce((highest, value) => value > highest ? value : highest) : 0n;
  const range = Math.max(1, maximum - minimum);
  const plotHeight = 168;
  const pointSpacing = 28;
  const plotWidth = Math.max(640, 40 + Math.max(0, history.length - 1) * pointSpacing);
  const chartPoints = history.map((item, index) => {
    const x = history.length < 2 ? plotWidth / 2 : 20 + (index / (history.length - 1)) * (plotWidth - 40);
    const y = 14 + (1 - (Number(item.price) - minimum) / range) * 110;
    return { x, y, value: `${x.toFixed(2)},${y.toFixed(2)}` };
  });
  const points = chartPoints.map((point) => point.value).join(" ");
  const selectedPoint = activePoint === null ? null : chartPoints[activePoint];
  const selectedHistory = activePoint === null ? null : history[activePoint];
  const finishDrag = (element: HTMLDivElement, pointerId: number) => {
    dragRef.current.active = false;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [history.length, market?.currentPrice]);

  return <section ref={marketRef} className="player-detail-market">
    <header><h4>시세</h4><p>현재가 <b>{market?.currentPrice ? `${squadPriceLabel(market.currentPrice)} BP` : "정보 없음"}</b></p></header>
    {history.length ? <>
      <div className="player-detail-market-range"><span>최고가 {squadPriceLabel(exactMaximum.toString())} BP</span><span>최저가 {squadPriceLabel(exactMinimum.toString())} BP</span></div>
      <div className="player-detail-market-scroll"
        ref={scrollRef}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragRef.current = { active: true, moved: false, startX: event.clientX, startLeft: event.currentTarget.scrollLeft };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current.active) return;
          const distance = event.clientX - dragRef.current.startX;
          if (Math.abs(distance) > 3) dragRef.current.moved = true;
          event.currentTarget.scrollLeft = dragRef.current.startLeft - distance;
        }}
        onPointerUp={(event) => finishDrag(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.currentTarget, event.pointerId)}
        onWheel={(event) => {
          event.preventDefault();
          event.currentTarget.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        }}
        role="region"
        aria-label="시세 기록 탐색"
        tabIndex={0}
      >
        <div className="player-detail-market-chart" style={{ width: `${plotWidth}px`, height: `${plotHeight}px` }}>
          <svg viewBox={`0 0 ${plotWidth} ${plotHeight}`} role="img" aria-label="최근 30개 시세 기록">
            <line x1="20" y1="14" x2={plotWidth - 20} y2="14" /><line x1="20" y1="69" x2={plotWidth - 20} y2="69" /><line x1="20" y1="124" x2={plotWidth - 20} y2="124" />
            <polygon className="player-detail-market-area" points={`20,124 ${points} ${plotWidth - 20},124`} />
            <polyline points={points} />
            {chartPoints.map((point, index) => <g
              className={activePoint === index ? "active" : undefined}
              key={`${history[index].date}-${index}`}
              onBlur={() => setActivePoint(null)}
              onFocus={() => setActivePoint(index)}
              onMouseEnter={() => { if (!dragRef.current.active) setActivePoint(index); }}
              onMouseLeave={() => setActivePoint(null)}
              onPointerDown={() => { if (!dragRef.current.moved) setActivePoint(index); }}
              role="button"
              tabIndex={0}
              aria-label={`${history[index].date} ${squadPriceLabel(history[index].price)} BP`}
            ><circle className="player-detail-market-hit" cx={point.x} cy={point.y} r="10" /><circle cx={point.x} cy={point.y} r="4" /></g>)}
            <g aria-hidden="true">{chartPoints.map((point, index) => <text className="player-detail-market-date-label" key={`${history[index].date}-${index}-label`} x={point.x} y="151" textAnchor="end" transform={`rotate(-55 ${point.x} 151)`}>{history[index].date}</text>)}</g>
          </svg>
          {selectedPoint && selectedHistory && <output className={`player-detail-market-tooltip${selectedPoint.y < 54 ? " is-below-point" : ""}`} style={{ left: `${(selectedPoint.x / plotWidth) * 100}%`, top: `${(selectedPoint.y / plotHeight) * 100}%` }}>
            <small>{selectedHistory.date}</small><b>{squadPriceLabel(selectedHistory.price)} BP</b>
          </output>}
        </div>
      </div>
    </> : <p className="player-detail-data-empty">제공된 시세 기록이 없습니다.</p>}
  </section>;
}

function PlayerDetailPanel({ player, controls }: { player: PlayerDetail; controls?: ReactNode }) {
  const [activeTrait, setActiveTrait] = useState<string | null>(null);
  const marketRef = useRef<HTMLElement | null>(null);
  const [marketHeight, setMarketHeight] = useState<number | null>(null);
  const filledSkillMoves = player.skillMoves?.match(/★/g)?.length ?? 0;
  const emptySkillMoves = player.skillMoves?.match(/☆/g)?.length ?? 0;
  const totalSkillMoves = filledSkillMoves + emptySkillMoves;
  const footStrongIndex = player.footStrong && player.foot ? player.foot.indexOf(player.footStrong) : -1;

  useEffect(() => {
    const market = marketRef.current;
    if (!market) return;
    const updateHeight = () => setMarketHeight(Math.ceil(market.getBoundingClientRect().height));
    const observer = new ResizeObserver(updateHeight);
    observer.observe(market);
    updateHeight();
    return () => observer.disconnect();
  }, [player.market]);

  const supplementStyle = marketHeight ? { "--player-detail-market-height": `${marketHeight}px` } as CSSProperties : undefined;

  return <article className="player-detail-panel">
    <div className="player-detail-hero">
      <div className="player-detail-image">
        {player.image ? <img src={player.image} alt={`${player.name} 선수`} /> : <span>NO IMAGE</span>}
      </div>
      <div className="player-detail-heading">
        <div>{player.seasonImage && <img src={player.seasonImage} alt="" />}<EnhancementBadge grade={player.grade} /></div>
        <h3>{player.name}</h3>
        <p>{player.season || "시즌 정보 없음"}</p>
        <div className="player-detail-key-values">
          <span><small>OVR</small><b>{player.ovr ?? "—"}</b></span>
          <span><small>급여</small><b>{player.pay ?? "—"}</b></span>
        </div>
      </div>
    </div>
    {controls}
    <div className="player-detail-positions">
      {player.positions.length ? player.positions.map((item) => <span key={item.position}><small>{item.position}</small><b>{item.value}</b></span>) : <p>포지션 정보가 없습니다.</p>}
    </div>
    <dl className="player-detail-basics">
      <div><dt>국가</dt><dd>{player.nationImage && <img src={player.nationImage} alt="" />}{player.nation || "정보 없음"}</dd></div>
      <div><dt>신체</dt><dd>{[player.height, player.weight].filter(Boolean).join(" · ") || "정보 없음"}</dd></div>
      <div><dt>체형</dt><dd>{player.bodyType || "정보 없음"}</dd></div>
      <div><dt>주발</dt><dd>{player.foot ? <span className="foot-label">{footStrongIndex >= 0 ? <>{player.foot.slice(0, footStrongIndex)}<strong>{player.footStrong}</strong>{player.foot.slice(footStrongIndex + player.footStrong!.length)}</> : player.foot}</span> : "정보 없음"}</dd></div>
      <div><dt>개인기</dt><dd>{totalSkillMoves ? <span className="skill-moves-rating" aria-label={`${filledSkillMoves}/${totalSkillMoves}`}>
        {Array.from({ length: totalSkillMoves }, (_, index) => <span key={index} className={index < filledSkillMoves ? "filled" : "empty"}>★</span>)}
      </span> : "정보 없음"}</dd></div>
      <div><dt>생년월일</dt><dd>{player.birthDate || "정보 없음"}</dd></div>
    </dl>
    <div className="player-detail-traits">
      <h4>특성</h4>
      <div>{player.traits.length ? player.traits.map((trait) => <button
        key={`${trait.name}-${trait.image}`}
        type="button"
        className={activeTrait === trait.name ? "active" : undefined}
        aria-label={trait.name}
        aria-expanded={activeTrait === trait.name}
        onClick={() => setActiveTrait((current) => current === trait.name ? null : trait.name)}
        onBlur={() => setActiveTrait(null)}
      >
        <img src={trait.image} alt="" />
        <span role="tooltip">{trait.name}</span>
      </button>) : <p>제공된 특성이 없습니다.</p>}</div>
    </div>
    <div className="player-detail-abilities">
      <h4>세부 능력치</h4>
      <div>{player.abilities.length ? player.abilities.map((ability) => <span key={ability.name}><small>{ability.name}</small><b className={ability.value >= 40 ? `ability-over-${Math.min(150, Math.floor(ability.value / 10) * 10)}` : undefined}>{ability.value}</b></span>) : <p>제공된 능력치가 없습니다.</p>}</div>
    </div>
    <div className="player-detail-supplement" style={supplementStyle}>
      <section className="player-detail-career">
        <header><h4>클럽 경력</h4></header>
        {player.career?.length ? <div className="player-detail-career-list">
          <div className="player-detail-career-head"><span>연도</span><span>클럽</span><span>임대 여부</span></div>
          {player.career.map((item, index) => <div key={`${item.year}-${item.club}-${index}`}><span>{item.year}</span><b>{item.club}</b><span>{item.loan || "—"}</span></div>)}
        </div> : <p className="player-detail-data-empty">제공된 클럽 경력이 없습니다.</p>}
      </section>
      <PlayerMarketChart market={player.market} marketRef={marketRef} />
    </div>
  </article>;
}

export function PlayerComparePanel({ left, right, onClose, onGradeChange, showClose = true }: { left: PlayerDetail; right: PlayerDetail; onClose?: () => void; onGradeChange?: (player: PlayerDetail, grade: number) => void; showClose?: boolean }) {
  const [activeCompareTrait, setActiveCompareTrait] = useState<string | null>(null);
  const displayFoot = (player: PlayerDetail) => {
    if (!player.foot) return "정보 없음";
    const strongIndex = player.footStrong ? player.foot.indexOf(player.footStrong) : -1;
    return <span className="foot-label">{strongIndex >= 0 ? <>{player.foot.slice(0, strongIndex)}<strong>{player.footStrong}</strong>{player.foot.slice(strongIndex + player.footStrong!.length)}</> : player.foot}</span>;
  };
  const displaySkillMoves = (player: PlayerDetail) => {
    const filled = player.skillMoves?.match(/★/g)?.length ?? 0;
    const total = player.skillMoves?.match(/[★☆]/g)?.length ?? 0;
    return total ? <span className="skill-moves-rating" aria-label={`${filled}/${total}`}>{Array.from({ length: total }, (_, index) => <span key={index} className={index < filled ? "filled" : "empty"}>★</span>)}</span> : "정보 없음";
  };
  const abilityClass = (value: number | undefined) => value !== undefined && value >= 40 ? `ability-over-${Math.min(150, Math.floor(value / 10) * 10)}` : undefined;
  const abilityNames = Array.from(new Set([...left.abilities.map((ability) => ability.name), ...right.abilities.map((ability) => ability.name)]));
  const leftAbilities = new Map(left.abilities.map((ability) => [ability.name, ability.value]));
  const rightAbilities = new Map(right.abilities.map((ability) => [ability.name, ability.value]));
  const basicRows = [
    [left.name, "선수", right.name],
    [left.seasonImage ? <img className="player-compare-season-image" src={left.seasonImage} alt={left.season || "시즌 정보 없음"} /> : left.season || "시즌 정보 없음", "시즌", right.seasonImage ? <img className="player-compare-season-image" src={right.seasonImage} alt={right.season || "시즌 정보 없음"} /> : right.season || "시즌 정보 없음"],
    [left.ovr ?? "—", "OVR", right.ovr ?? "—"],
    [left.pay ?? "—", "급여", right.pay ?? "—"],
    [left.market?.currentPrice ? `${squadPriceLabel(left.market.currentPrice)} BP` : "정보 없음", "현재가", right.market?.currentPrice ? `${squadPriceLabel(right.market.currentPrice)} BP` : "정보 없음"],
    [left.nation || "정보 없음", "국가", right.nation || "정보 없음"],
    [[left.height, left.weight].filter(Boolean).join(" · ") || "정보 없음", "신체", [right.height, right.weight].filter(Boolean).join(" · ") || "정보 없음"],
    [left.bodyType || "정보 없음", "체형", right.bodyType || "정보 없음"],
    [displayFoot(left), "주발", displayFoot(right)],
    [displaySkillMoves(left), "개인기", displaySkillMoves(right)],
    [left.birthDate || "정보 없음", "생년월일", right.birthDate || "정보 없음"]
  ] as const;

  const ComparisonRows = ({ children }: { children: ReactNode }) => <div className="player-compare-rows">{children}</div>;
  const ComparisonRow = ({ leftValue, label, rightValue, ability = false, className, leftClass, rightClass, leftDelta, rightDelta }: { leftValue: ReactNode; label: string; rightValue: ReactNode; ability?: boolean; className?: string; leftClass?: string; rightClass?: string; leftDelta?: number; rightDelta?: number }) => <div className={`player-compare-row${ability ? " ability" : ""}${className ? ` ${className}` : ""}`}>
    <b className={leftClass}>{leftDelta !== undefined && <small>+{leftDelta}</small>}{leftValue}</b><span>{label}</span><b className={rightClass}>{rightValue}{rightDelta !== undefined && <small>+{rightDelta}</small>}</b>
  </div>;
  const ComparisonCareer = ({ player }: { player: PlayerDetail }) => <section className="player-compare-supplement">
    <section className="player-detail-career">
      {player.career?.length ? <div className="player-detail-career-list">
        <div className="player-detail-career-head"><span>연도</span><span>클럽</span><span>임대 여부</span></div>
        {player.career.map((item, index) => <div key={`${item.year}-${item.club}-${index}`}><span>{item.year}</span><b>{item.club}</b><span>{item.loan || "—"}</span></div>)}
      </div> : <p className="player-detail-data-empty">제공된 클럽 경력이 없습니다.</p>}
    </section>
  </section>;
  const ComparisonMarket = ({ player }: { player: PlayerDetail }) => <section className="player-compare-supplement">
    <PlayerMarketChart market={player.market} />
  </section>;

  return <article className="player-compare-panel">
    <div className="player-compare-players">
      {[left, right].map((player, index) => <div key={`${player.spid}-${player.grade}`} className={`player-compare-player player-${index === 0 ? "a" : "b"}`}>
        <div className="player-compare-image">{player.image ? <img src={player.image} alt={`${player.name} 선수`} draggable={false} /> : <span>NO IMAGE</span>}</div>
        <div className="player-compare-summary">
          <div className="player-compare-identity">
            <strong>{player.name}</strong>
          </div>
          <div className="player-compare-badges">
            {player.seasonImage ? <img src={player.seasonImage} alt={player.season || "시즌 정보 없음"} /> : null}
            {player.nationImage ? <img src={player.nationImage} alt={player.nation || "국가 정보 없음"} /> : null}
          </div>
          <div className="player-compare-position-summary">
            {player.positions.slice(0, 3).map((item) => <span key={item.position}><small>{item.position}</small><b>{item.value}</b></span>)}
          </div>
          <p>{[player.birthDate, [player.height, player.weight].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}</p>
          <p>
            {player.bodyType ? <>{player.bodyType} · </> : null}
            {displayFoot(player)}
          </p>
        </div>
      </div>)}
      <span className="player-compare-vs" aria-hidden="true">VS</span>
      {showClose && onClose ? <button aria-label="선수 비교 닫기" className="player-compare-close" type="button" onClick={onClose}>×</button> : null}
    </div>
    <section className="player-compare-section">
      <h3>선수 정보</h3>
      <ComparisonRows>
        {basicRows.slice(0, 2).map(([leftValue, label, rightValue]) => <ComparisonRow key={label} leftValue={leftValue} label={label} rightValue={rightValue} className={label === "시즌" ? "season" : undefined} />)}
        <ComparisonRow
          leftValue={onGradeChange ? <select className="player-compare-grade-select" aria-label={`${left.name} 강화 단계`} value={left.grade} onChange={(event) => onGradeChange(left, Number(event.target.value))}>{Array.from({ length: 13 }, (_, index) => <option key={index + 1} value={index + 1}>+{index + 1}</option>)}</select> : `+${left.grade}`}
          label="강화"
          rightValue={onGradeChange ? <select className="player-compare-grade-select" aria-label={`${right.name} 강화 단계`} value={right.grade} onChange={(event) => onGradeChange(right, Number(event.target.value))}>{Array.from({ length: 13 }, (_, index) => <option key={index + 1} value={index + 1}>+{index + 1}</option>)}</select> : `+${right.grade}`}
        />
        {basicRows.slice(2).map(([leftValue, label, rightValue]) => <ComparisonRow key={label} leftValue={leftValue} label={label} rightValue={rightValue} leftClass={label === "OVR" ? abilityClass(left.ovr) : undefined} rightClass={label === "OVR" ? abilityClass(right.ovr) : undefined} />)}
      </ComparisonRows>
    </section>
    {(left.positions.length > 0 || right.positions.length > 0) && <section className="player-compare-section">
      <h3>포지션</h3>
      <div className="player-compare-holdings positions">
        <div>{left.positions.map((item) => <span key={item.position}><small>{item.position}</small><b>{item.value}</b></span>)}</div>
        <i aria-hidden="true" />
        <div>{right.positions.map((item) => <span key={item.position}><small>{item.position}</small><b>{item.value}</b></span>)}</div>
      </div>
    </section>}
    {(left.traits.length > 0 || right.traits.length > 0) && <section className="player-compare-section">
      <h3>특성</h3>
      <div className="player-compare-holdings traits">
        <div>{left.traits.map((trait) => <button
          key={`${trait.name}-${trait.image}`}
          type="button"
          className={activeCompareTrait === `left-${trait.name}` ? "active" : undefined}
          aria-label={trait.name}
          aria-expanded={activeCompareTrait === `left-${trait.name}`}
          onClick={() => setActiveCompareTrait((current) => current === `left-${trait.name}` ? null : `left-${trait.name}`)}
          onBlur={() => setActiveCompareTrait(null)}
        ><img src={trait.image} alt="" /><span role="tooltip">{trait.name}</span></button>)}</div>
        <i aria-hidden="true" />
        <div>{right.traits.map((trait) => <button
          key={`${trait.name}-${trait.image}`}
          type="button"
          className={activeCompareTrait === `right-${trait.name}` ? "active" : undefined}
          aria-label={trait.name}
          aria-expanded={activeCompareTrait === `right-${trait.name}`}
          onClick={() => setActiveCompareTrait((current) => current === `right-${trait.name}` ? null : `right-${trait.name}`)}
          onBlur={() => setActiveCompareTrait(null)}
        ><img src={trait.image} alt="" /><span role="tooltip">{trait.name}</span></button>)}</div>
      </div>
    </section>}
    <section className="player-compare-section">
      <h3>세부 능력치</h3>
      <ComparisonRows>{abilityNames.length ? abilityNames.map((ability) => {
        const leftValue = leftAbilities.get(ability);
        const rightValue = rightAbilities.get(ability);
        const difference = leftValue !== undefined && rightValue !== undefined ? Math.abs(leftValue - rightValue) : 0;
        return <ComparisonRow key={ability} ability leftValue={leftValue ?? "—"} label={ability} rightValue={rightValue ?? "—"} leftClass={abilityClass(leftValue)} rightClass={abilityClass(rightValue)} leftDelta={difference > 0 && leftValue! > rightValue! ? difference : undefined} rightDelta={difference > 0 && rightValue! > leftValue! ? difference : undefined} />;
      }) : <ComparisonRow leftValue="—" label="능력치" rightValue="—" />}</ComparisonRows>
    </section>
    <section className="player-compare-section">
      <h3>클럽 경력</h3>
      <div className="player-compare-supplements"><ComparisonCareer player={left} /><ComparisonCareer player={right} /></div>
    </section>
    <section className="player-compare-section">
      <h3>시세</h3>
      <div className="player-compare-supplements"><ComparisonMarket player={left} /><ComparisonMarket player={right} /></div>
    </section>
  </article>;
}

export type HomeView = "home" | "pick" | "managers" | "ranking" | "players" | "faq";

function InsightSectionIcon({ kind }: { kind: "formation" | "team-color" }) {
  return <span className="home-insight-section-icon" aria-hidden="true">{kind === "formation" ?
    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M3 12h18" /><circle cx="12" cy="12" r="2.5" /></svg> :
    <svg viewBox="0 0 24 24"><path d="M8 5 10 3h4l2 2 4 2-2 5-2-1v9H8v-9l-2 1-2-5 4-2Z" /></svg>}
  </span>;
}

function FormationMiniPitch({ name }: { name: string }) {
  const lines = name.split("-").map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return <svg className="home-insight-mini-pitch" aria-label={`${name} 포메이션 배치`} viewBox="0 0 100 72" role="img">
    <path d="M3 3h94v66H3zM38 3v9h24V3M3 36h94M39 36a11 11 0 0 0 22 0M38 69v-9h24v9" />
    <circle cx="50" cy="63" r="2.7" />
    {lines.map((count, lineIndex) => Array.from({ length: count }, (_, playerIndex) =>
      <circle key={`${lineIndex}-${playerIndex}`} cx={(playerIndex + 1) * 100 / (count + 1)} cy={50 - lineIndex * (38 / Math.max(1, lines.length - 1))} r="2.7" />))}
  </svg>;
}

function InsightPreviewPanel({ kind, title, items, href }: {
  kind: "formation" | "team-color"; title: string; items: HomeInsightItem[]; href: string;
}) {
  return <section className={`home-insight-panel is-${kind}`} aria-label={`${title} 랭킹`}>
    <header>
      <div className="home-insight-panel-title"><InsightSectionIcon kind={kind} /><div><h2>{title}</h2></div></div>
      <a className="home-insight-more" href={href}>전체 보기</a>
    </header>
    <div className="home-insight-featured-grid">
      {items.slice(0, 3).map((item, index) => <article className={`home-insight-featured-card rank-${index + 1}`} key={item.name} style={kind === "team-color" && item.image ? { "--team-emblem": `url(${JSON.stringify(item.image)})` } as CSSProperties : undefined}>
        <div className="home-insight-featured-heading"><span>{index + 1}</span><h3>{item.name}</h3></div>
        <div className={`home-insight-featured-visual is-${kind}`}>
          {kind === "formation" ? <FormationMiniPitch name={item.name} /> : item.image ? <img src={item.image} alt={`${item.name} 로고`} loading="lazy" decoding="async" /> : null}
        </div>
        <div className="home-insight-featured-meta"><b>{item.count.toLocaleString()}명</b><strong>{item.rate.toFixed(1)}%</strong></div>
        <div className="home-insight-meter"><i style={{ width: `${Math.max(4, item.rate)}%` }} /></div>
      </article>)}
    </div>
    <div className="home-insight-compact-list">
      {items.slice(3, 5).map((item, index) => <article className="home-insight-compact-row" key={item.name}>
        <span className="home-insight-compact-rank">{index + 4}</span>
        {kind === "team-color" && item.image ? <span className="home-insight-compact-logo"><img src={item.image} alt="" loading="lazy" decoding="async" /></span> : null}
        <h3>{item.name}</h3>
        <div className="home-insight-meter"><i style={{ width: `${Math.max(4, item.rate)}%` }} /></div>
        <b>{item.count.toLocaleString()}명</b><strong>{item.rate.toFixed(1)}%</strong>
      </article>)}
    </div>
  </section>;
}

function HomeInsights() {
  const [data, setData] = useState<HomeInsightsResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/api/home-insights`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "랭킹 데이터를 불러오지 못했습니다.");
        setData(payload);
      })
      .catch((requestError) => { if (requestError?.name !== "AbortError") setError(requestError instanceof Error ? requestError.message : "랭킹 데이터를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, []);

  if (error) return <section className="home-insights home-insights-state"><p>{error}</p></section>;
  if (!data) return <section className="home-insights home-insights-state"><p>포메이션과 팀컬러 랭킹을 집계하고 있습니다.</p></section>;
  return <section className="home-insights" id="meta-preview" aria-label="랭커 메타 랭킹">
    <InsightPreviewPanel kind="formation" title="포메이션 랭킹" items={data.formations.items} href="/ranking#formations" />
    <InsightPreviewPanel kind="team-color" title="팀컬러 랭킹" items={data.teamColors.items} href="/ranking#team-colors" />
  </section>;
}

export default function Home({ view = "home" }: { view?: HomeView }) {
  const [activeSection, setActiveSection] = useState("analysis");
  const [rankStart, setRankStart] = useState("1");
  const [rankEnd, setRankEnd] = useState("1000");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("ST");
  const [detailedPositions, setDetailedPositions] = useState(false);
  const [adaptationEnabled, setAdaptationEnabled] = useState(false);
  const [query, setQuery] = useState<Query>({ start: "1", end: "1000", team: "", position: "ST", detailed: false, adaptation: 0 });
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [teamColors, setTeamColors] = useState<Array<{ name: string; managers: number }>>([]);
  const [result, setResult] = useState<PickResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [comparisonPlayer, setComparisonPlayer] = useState<PickItem | null>(null);
  const [playerModalMode, setPlayerModalMode] = useState<"detail" | "compare" | null>(null);
  const [playerModalItems, setPlayerModalItems] = useState<PlayerDetail[]>([]);
  const [playerModalLoading, setPlayerModalLoading] = useState(false);
  const [playerModalError, setPlayerModalError] = useState("");
  const [playerDetailSource, setPlayerDetailSource] = useState<PickItem | null>(null);
  const [playerDetailGrade, setPlayerDetailGrade] = useState(1);
  const [playerDetailAdaptation, setPlayerDetailAdaptation] = useState(0);
  const playerDetailCache = useRef(new Map<string, PlayerDetail>());
  const playerDetailRequest = useRef(0);
  const [rankingTeam, setRankingTeam] = useState("");
  const [rankingResult, setRankingResult] = useState<RankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [rankingError, setRankingError] = useState("");
  const [rankingPage, setRankingPage] = useState(1);
  const [rankingNickname, setRankingNickname] = useState("");
  const [rankingSearchActive, setRankingSearchActive] = useState(false);
  const [rankingSearchLabel, setRankingSearchLabel] = useState("");
  const [rankingCategory, setRankingCategory] = useState<"managers" | MetaTab>("managers");
  const [profileNickname, setProfileNickname] = useState("");
  const [profileResult, setProfileResult] = useState<UserProfileResponse | null>(null);
  const [liveProfileResult, setLiveProfileResult] = useState<LiveUserResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [historyFrame, setHistoryFrame] = useState<HistoryFrame>("hour");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesHasMore, setMatchesHasMore] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [modalNickname, setModalNickname] = useState("");
  const [modalProfile, setModalProfile] = useState<UserProfileResponse | null>(null);
  const [modalMatches, setModalMatches] = useState<MatchItem[]>([]);
  const [modalSelectedMatch, setModalSelectedMatch] = useState<MatchItem | null>(null);
  const [modalTab, setModalTab] = useState<"summary" | "squad" | "matches">("summary");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [modalHistoryFrame, setModalHistoryFrame] = useState<HistoryFrame>("hour");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const modalRequest = useRef(0);
  const modalScrollPosition = useRef(0);
  const teamColorNames = teamColors.map((color) => color.name).sort((a, b) => a.localeCompare(b, "ko-KR"));

  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 80);
    updateScrollTopVisibility();
    window.addEventListener("scroll", updateScrollTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollTopVisibility);
  }, []);

  useEffect(() => {
    if (view !== "managers") return;
    const searchedNickname = new URLSearchParams(window.location.search).get("nickname")?.trim() || "";
    const draftNickname = window.sessionStorage.getItem(managerSearchDraftKey)?.trim() || "";
    const draftSource = window.sessionStorage.getItem(managerSearchDraftSourceKey)?.trim() || "";
    setProfileNickname(draftNickname && draftSource === searchedNickname ? draftNickname : searchedNickname || draftNickname);
    if (searchedNickname) void loadProfile(searchedNickname);
    // The URL query is the only trigger for the header search handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view !== "ranking") return;
    const syncRankingCategory = () => {
      const hash = window.location.hash;
      setRankingCategory(hash === "#formations" ? "formations" : hash === "#team-colors" ? "team-colors" : "managers");
    };
    syncRankingCategory();
    window.addEventListener("hashchange", syncRankingCategory);
    return () => window.removeEventListener("hashchange", syncRankingCategory);
  }, [view]);

  useEffect(() => {
    if (!playerModalMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closePlayerModal(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [playerModalMode]);

  useEffect(() => {
    const ids = ["analysis", "user-search", "ranking", "community", "support"];
    function updateActiveSection() {
      let closestId = ids[0];
      let closestDistance = Infinity;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        const distance = Math.abs(element.getBoundingClientRect().top);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestId = id;
        }
      }
      setActiveSection(closestId);
    }
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    const interval = window.setInterval(updateActiveSection, 250);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.clearInterval(interval);
    };
  }, []);

  async function loadPlayerDetail(player: PickItem, grade = player.grade, adaptation = player.adaptation) {
    const key = `${player.spid}:${grade}:${adaptation}`;
    const cached = playerDetailCache.current.get(key);
    if (cached) return cached;
    const parameters = new URLSearchParams({ spid: player.spid, grade: String(grade), adaptation: String(adaptation) });
    const response = await fetch(`${apiBaseUrl}/api/players/details?${parameters}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.player) throw new Error(payload.message || "선수 정보를 불러오지 못했습니다.");
    playerDetailCache.current.set(key, payload.player);
    return payload.player as PlayerDetail;
  }

  function closePlayerModal() {
    playerDetailRequest.current += 1;
    setPlayerModalMode(null);
    setPlayerModalItems([]);
    setPlayerModalError("");
    setPlayerModalLoading(false);
    setPlayerDetailSource(null);
    setComparisonPlayer(null);
  }

  async function requestPlayerDetail(player: PickItem, grade: number, adaptation: number) {
    const requestId = ++playerDetailRequest.current;
    setPlayerModalError("");
    setPlayerModalLoading(true);
    try {
      const detail = await loadPlayerDetail(player, grade, adaptation);
      if (requestId === playerDetailRequest.current) setPlayerModalItems([detail]);
    } catch (detailError) {
      if (requestId === playerDetailRequest.current) setPlayerModalError(detailError instanceof Error ? detailError.message : "선수 정보를 불러오지 못했습니다.");
    } finally {
      if (requestId === playerDetailRequest.current) setPlayerModalLoading(false);
    }
  }

  function openPlayerDetail(player: PickItem) {
    setPlayerModalMode("detail");
    setPlayerModalItems([]);
    setPlayerDetailSource(player);
    setPlayerDetailGrade(player.grade);
    setPlayerDetailAdaptation(player.adaptation);
    void requestPlayerDetail(player, player.grade, player.adaptation);
  }

  function changePlayerDetailGrade(grade: number) {
    if (!playerDetailSource) return;
    setPlayerDetailGrade(grade);
    void requestPlayerDetail(playerDetailSource, grade, playerDetailAdaptation);
  }

  function changePlayerDetailAdaptation(adaptation: number) {
    if (!playerDetailSource) return;
    setPlayerDetailAdaptation(adaptation);
    void requestPlayerDetail(playerDetailSource, playerDetailGrade, adaptation);
  }

  async function togglePlayerComparison(player: PickItem) {
    if (!comparisonPlayer) {
      setComparisonPlayer(player);
      return;
    }
    if (comparisonPlayer.spid === player.spid && comparisonPlayer.grade === player.grade) {
      setComparisonPlayer(null);
      return;
    }
    setPlayerModalMode("compare");
    setPlayerModalItems([]);
    setPlayerModalError("");
    setPlayerModalLoading(true);
    try {
      setPlayerModalItems(await Promise.all([loadPlayerDetail(comparisonPlayer), loadPlayerDetail(player)]));
    } catch (detailError) {
      setPlayerModalError(detailError instanceof Error ? detailError.message : "선수 비교 정보를 불러오지 못했습니다.");
    } finally {
      setPlayerModalLoading(false);
    }
  }

  function scrollToRankingTop() {
    window.requestAnimationFrame(() => {
      document.getElementById("ranking")?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }

  async function fetchRankings(nextTeam = "", page = 1, shouldScroll = false) {
    setRankingLoading(true);
    setRankingError("");
    setRankingSearchActive(false);
    setRankingSearchLabel("");
    const parameters = new URLSearchParams({
      rankStart: "1",
      rankEnd: "10000",
      offset: String((page - 1) * rankingPageSize),
      limit: String(rankingPageSize),
    });
    if (nextTeam) parameters.set("teamColor", nextTeam);
    try {
      const response = await fetch(`${apiBaseUrl}/api/rankings?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "랭킹을 불러오지 못했습니다.");
      setRankingResult(payload);
      setRankingPage(page);
      if (shouldScroll) scrollToRankingTop();
    } catch (requestError) {
      setRankingResult(null);
      setRankingError(requestError instanceof Error ? requestError.message : "랭킹을 불러오지 못했습니다.");
    } finally {
      setRankingLoading(false);
    }
  }

  async function searchRanking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = rankingNickname.trim();
    trackAnalytics("search", { nickname, teamColor: rankingTeam }, "ranking_manager");
    if (!nickname) {
      await fetchRankings(rankingTeam, 1, true);
      return;
    }
    setRankingLoading(true);
    setRankingError("");
    try {
      const parameters = new URLSearchParams({ nickname });
      const response = await fetch(`${apiBaseUrl}/api/rankings/search?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "구단주 검색에 실패했습니다.");
      setRankingResult(payload);
      setRankingPage(1);
      setRankingSearchActive(true);
      setRankingSearchLabel(nickname);
      scrollToRankingTop();
    } catch (requestError) {
      setRankingResult(null);
      setRankingError(requestError instanceof Error ? requestError.message : "구단주 검색에 실패했습니다.");
    } finally {
      setRankingLoading(false);
    }
  }

  async function loadRecentMatches(nickname: string, offset = 0, append = false) {
    setMatchesLoading(true);
    try {
      const parameters = new URLSearchParams({ nickname, offset: String(offset), limit: "20" });
      const response = await fetch(`${apiBaseUrl}/api/users/matches?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "최근 경기를 불러오지 못했습니다.");
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setMatches((current) => append ? [...current, ...nextItems] : nextItems);
      setMatchesHasMore(Boolean(payload.hasMore));
      if (!append) setSelectedMatch(nextItems[0] || null);
    } catch (requestError) {
      if (!append) setMatches([]);
      setProfileError(requestError instanceof Error ? requestError.message : "최근 경기를 불러오지 못했습니다.");
    } finally {
      setMatchesLoading(false);
    }
  }

  async function searchProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = profileNickname.trim();
    if (!nickname) return;
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("nickname", nickname);
    window.history.replaceState(null, "", `${window.location.pathname}?${parameters}`);
    window.sessionStorage.setItem(managerSearchDraftKey, nickname);
    window.sessionStorage.setItem(managerSearchDraftSourceKey, nickname);
    await loadProfile(nickname);
  }

  function changeProfileNickname(nickname: string) {
    setProfileNickname(nickname);
    const activeNickname = new URLSearchParams(window.location.search).get("nickname")?.trim() || "";
    if (nickname) window.sessionStorage.setItem(managerSearchDraftKey, nickname);
    else window.sessionStorage.removeItem(managerSearchDraftKey);
    window.sessionStorage.setItem(managerSearchDraftSourceKey, activeNickname);
  }

  async function loadProfile(nickname: string) {
    trackAnalytics("search", { nickname }, "owner_profile");
    setProfileLoading(true);
    setProfileError("");
    setProfileResult(null);
    setLiveProfileResult(null);
    setMatches([]);
    setSelectedMatch(null);
    try {
      const parameters = new URLSearchParams({ nickname });
      const [response, liveResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/users/profile?${parameters}`, { cache: "no-store" }),
        fetch(`${apiBaseUrl}/api/users/live-profile?${parameters}`, { cache: "no-store" }).catch(() => null),
      ]);
      const payload = await response.json();
      const livePayload = liveResponse ? await liveResponse.json() : null;
      if (response.status === 404 && payload.code === "USER_NOT_FOUND") {
        if (!liveResponse?.ok) throw new Error(livePayload?.message || "구단주 정보를 불러오지 못했습니다.");
        setLiveProfileResult(livePayload);
        return;
      }
      if (!response.ok) throw new Error(payload.message || "구단주 정보를 불러오지 못했습니다.");
      setProfileResult(payload);
      if (liveResponse?.ok) setLiveProfileResult(livePayload);
      if (payload.profile?.hasOuid) void loadRecentMatches(payload.profile.nickname);
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : "구단주 정보를 불러오지 못했습니다.");
    } finally {
      setProfileLoading(false);
    }
  }

  async function openRankerModal(ranker: RankingItem) {
    const requestId = ++modalRequest.current;
    modalScrollPosition.current = window.scrollY;
    setModalNickname(ranker.nickname);
    setModalProfile(null);
    setModalMatches([]);
    setModalSelectedMatch(null);
    setModalTab("summary");
    setModalHistoryFrame("hour");
    setModalError("");
    setModalLoading(true);
    try {
      const profileParameters = new URLSearchParams({ nickname: ranker.nickname });
      const profileResponse = await fetch(`${apiBaseUrl}/api/users/profile?${profileParameters}`, { cache: "no-store" });
      const profilePayload = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profilePayload.message || "구단주 정보를 불러오지 못했습니다.");
      if (modalRequest.current !== requestId) return;
      setModalProfile(profilePayload);

      if (profilePayload.profile?.hasOuid) {
        const matchParameters = new URLSearchParams({ nickname: profilePayload.profile.nickname, offset: "0", limit: "20" });
        const matchResponse = await fetch(`${apiBaseUrl}/api/users/matches?${matchParameters}`, { cache: "no-store" });
        const matchPayload = await matchResponse.json();
        if (modalRequest.current !== requestId) return;
        if (matchResponse.ok) {
          const items = Array.isArray(matchPayload.items) ? matchPayload.items : [];
          setModalMatches(items);
          setModalSelectedMatch(items[0] || null);
        }
      }
    } catch (requestError) {
      if (modalRequest.current === requestId) setModalError(requestError instanceof Error ? requestError.message : "구단주 정보를 불러오지 못했습니다.");
    } finally {
      if (modalRequest.current === requestId) setModalLoading(false);
    }
  }

  function closeRankerModal() {
    modalRequest.current += 1;
    setModalNickname("");
    window.requestAnimationFrame(() => window.scrollTo({ top: modalScrollPosition.current, behavior: "auto" }));
  }

  async function fetchPicks(nextQuery: Query, offset = 0, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    if (!append) {
      setError("");
      setResult(null);
    }
    const parameters = new URLSearchParams({
      rankStart: nextQuery.start,
      rankEnd: nextQuery.end,
      position: nextQuery.position,
      detailedPositions: String(nextQuery.detailed),
      adaptation: String(nextQuery.adaptation),
      offset: String(offset),
      limit: "3",
    });
    if (nextQuery.team) parameters.set("teamColor", nextQuery.team);

    try {
      const response = await fetch(`${apiBaseUrl}/api/pick-rates?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "데이터를 불러오지 못했습니다.");
      setResult((current) =>
        append && current
          ? { ...payload, items: [...current.items, ...payload.items] }
          : payload,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function fetchAvailablePositions(nextQuery: Omit<Query, "position">) {
    const parameters = new URLSearchParams({
      rankStart: nextQuery.start,
      rankEnd: nextQuery.end,
      detailedPositions: String(nextQuery.detailed),
    });
    if (nextQuery.team) parameters.set("teamColor", nextQuery.team);
    try {
      const response = await fetch(`${apiBaseUrl}/api/positions?${parameters}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "포지션 정보를 불러오지 못했습니다.");
      const names = new Set<string>(
        Array.isArray(payload.items) ? payload.items.map((item: { name: string }) => item.name) : [],
      );
      const ordered = positionPriority.filter((item) => names.has(item));
      setAvailablePositions(ordered);
      return ordered;
    } catch {
      setAvailablePositions([]);
      return [];
    }
  }

  useEffect(() => {
    // Initial ranking synchronization intentionally begins after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRankings();
    void fetch(`${apiBaseUrl}/api/team-colors`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setTeamColors(Array.isArray(payload.items) ? payload.items : []))
      .catch(() => setTeamColors([]));
  }, []);

  useEffect(() => {
    const nickname = rankingNickname.trim();
    if (!nickname) {
      if (rankingSearchActive) {
        const timer = window.setTimeout(() => void fetchRankings(rankingTeam, 1), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRankingLoading(true);
      setRankingError("");
      try {
        const parameters = new URLSearchParams({ nickname });
        const response = await fetch(`${apiBaseUrl}/api/rankings/search?${parameters}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "구단주 검색에 실패했습니다.");
        setRankingResult(payload);
        setRankingPage(1);
        setRankingSearchActive(true);
        setRankingSearchLabel(nickname);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setRankingResult(null);
        setRankingError(requestError instanceof Error ? requestError.message : "구단주 검색에 실패했습니다.");
      } finally {
        if (!controller.signal.aborted) setRankingLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Nickname changes are the only trigger; ranking/team state is handled inside each request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingNickname]);

  useEffect(() => {
    if (!modalNickname) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRankerModal();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modalNickname]);

  async function applyFilters() {
    setHasSearched(true);
    setLoading(true);
    setResult(null);
    setError("");
    const baseQuery = { start: rankStart, end: rankEnd, team, detailed: detailedPositions, adaptation: adaptationEnabled ? 5 : 0 };
    const available = await fetchAvailablePositions(baseQuery);
    const nextPosition = available.includes(position) ? position : (available[0] || position);
    setPosition(nextPosition);
    const nextQuery = { ...baseQuery, position: nextPosition };
    trackAnalytics("search", nextQuery, "player_pick_rate");
    setQuery(nextQuery);
    await fetchPicks(nextQuery);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void applyFilters();
  }

  function selectPosition(nextPosition: string) {
    setPosition(nextPosition);
    const nextQuery = { start: rankStart, end: rankEnd, team, position: nextPosition, detailed: detailedPositions, adaptation: adaptationEnabled ? 5 : 0 };
    setQuery(nextQuery);
    void fetchPicks(nextQuery);
  }

  async function toggleDetailedPositions() {
    const nextDetailed = !detailedPositions;
    setDetailedPositions(nextDetailed);
    if (!hasSearched) return;

    const baseQuery = { start: rankStart, end: rankEnd, team, detailed: nextDetailed, adaptation: adaptationEnabled ? 5 : 0 };
    const available = await fetchAvailablePositions(baseQuery);
    const nextPosition = available.includes(position) ? position : (available[0] || position);
    setPosition(nextPosition);
    const nextQuery = { ...baseQuery, position: nextPosition };
    setQuery(nextQuery);
    await fetchPicks(nextQuery);
  }

  async function toggleAdaptation() {
    const nextEnabled = !adaptationEnabled;
    const nextAdaptation = nextEnabled ? 5 : 0;
    setAdaptationEnabled(nextEnabled);
    if (!hasSearched) return;
    const nextQuery = { ...query, adaptation: nextAdaptation };
    setQuery(nextQuery);
    await fetchPicks(nextQuery);
  }

  function selectRankingCategory(category: "managers" | MetaTab) {
    setRankingCategory(category);
    const hash = category === "managers" ? "" : `#${category}`;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }

  const isHome = view === "home";
  const showsAnalysis = view === "pick" || view === "players";
  const showsManagers = view === "managers";
  const showsRanking = view === "ranking";
  const showsFaq = view === "faq";

  return (
    <main>
      <SiteHeader active={view === "home" ? null : view} />

      {showScrollTop ? <a className="scroll-top-button" href={isHome ? "#top" : "/"} aria-label="맨 위로 이동">↑</a> : null}

      {isHome && <><section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> MANAGER MODE INTELLIGENCE</p>
          <h1>감독모드,<br /><em>감이 아니라 데이터로.</em></h1>
          <p className="hero-description">
            상위 10,000명의 실제 선발 스쿼드를 분석해<br className="desktop-break" /> 포지션별 선수 픽률을 가장 빠르게 확인하세요.
          </p>
        </div>
      </section>

      <section className="home-quick-links" aria-label="주요 기능 바로가기">
        <a href="/pick">
          <span className="home-quick-link-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><circle cx="16.5" cy="9" r="2.5" /><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M14 14h2.5a4 4 0 0 1 4 4v1" /></svg></span>
          <span className="home-quick-link-copy"><b>선수 픽률</b></span>
          <span className="home-quick-link-arrow" aria-hidden="true">→</span>
        </a>
        <a href="/players">
          <span className="home-quick-link-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="9" r="2.5" /><path d="M8 17a4 4 0 0 1 8 0" /></svg></span>
          <span className="home-quick-link-copy"><b>선수 정보</b></span>
          <span className="home-quick-link-arrow" aria-hidden="true">→</span>
        </a>
        <a href="/managers">
          <span className="home-quick-link-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></svg></span>
          <span className="home-quick-link-copy"><b>구단주 검색</b></span>
          <span className="home-quick-link-arrow" aria-hidden="true">→</span>
        </a>
        <a href="/ranking">
          <span className="home-quick-link-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19V12M10 19V8M15 19V4M20 19V10" /></svg></span>
          <span className="home-quick-link-copy"><b>감독모드 랭킹</b></span>
          <span className="home-quick-link-arrow" aria-hidden="true">→</span>
        </a>
        <a href="/community">
          <span className="home-quick-link-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a7 7 0 0 1-7 7H8l-4 3 1.2-4.8A7 7 0 1 1 20 11Z" /></svg></span>
          <span className="home-quick-link-copy"><b>커뮤니티</b></span>
          <span className="home-quick-link-arrow" aria-hidden="true">→</span>
        </a>
      </section>

      <HomeInsights />

      <CommunityPreview />

      <ResponsiveAd label="메인 하단 광고" /></>}

      {showsAnalysis && <><section className={`analysis-shell${hasSearched ? "" : " is-initial"}`} id="analysis">
        <div className="section-heading">
          <div><p className="section-kicker">PLAYER PICK RATE</p><h2>픽률 분석</h2></div>
          <div className={`data-status ${error ? "status-error" : ""}`}>
            <span className="status-dot" /> {!hasSearched ? "조회 전" : loading ? "데이터 확인 중" : snapshotLabel(result?.snapshot.data_time)}
          </div>
        </div>

        <div className="analysis-panel-group">
        <aside className="position-panel">
          <div className="position-adaptation"><CompactSwitch label="적응도" checked={adaptationEnabled} showStateText={false} onChange={() => void toggleAdaptation()} /></div>
          <div className="position-panel-heading">
            <CompactSwitch label="상세 포지션" checked={detailedPositions} showStateText={false} onChange={() => void toggleDetailedPositions()} />
          </div>
          <div className="position-grid">
            {!hasSearched ? <p className="position-empty">조회 후 사용할 수 있는 포지션이 표시됩니다.</p> : availablePositions.length > 0 ? availablePositions.map((item) => (
              <button className={position === item ? "selected" : ""} key={item} onClick={() => selectPosition(item)} type="button">{item}</button>
            )) : <p className="position-empty">사용 데이터가 있는 포지션이 없습니다.</p>}
          </div>
        </aside>

        <form className="filter-panel" onSubmit={submit}>
          <div className="analysis-filter-fields">
            <div className="analysis-rank-group">
              <span className="analysis-filter-label">랭킹 범위</span>
              <div className="analysis-rank-controls">
                <label><span>시작 랭킹</span><input aria-label="시작 랭킹" inputMode="numeric" min="1" max="10000" type="number" value={rankStart} onChange={(event) => setRankStart(event.target.value)} /><b>위</b></label>
                <i aria-hidden="true">—</i>
                <label><span>끝 랭킹</span><input aria-label="끝 랭킹" inputMode="numeric" min="1" max="10000" type="number" value={rankEnd} onChange={(event) => setRankEnd(event.target.value)} /><b>위</b></label>
              </div>
            </div>
            <TeamAutocomplete id="pick-team-color" label="팀컬러" value={team} options={teamColorNames} onChange={setTeam} />
          </div>

          <button className="search-button" type="submit" disabled={loading}>
            <span>{loading ? "조회 중" : "픽률 조회"}</span>
          </button>
        </form>

        <div className="results-layout">
          <div className="result-content">
            {hasSearched && <div className="result-topline">
              {result && (
                <div className="result-stats">
                  <span>감독 <b>{result.matchingManagers.toLocaleString()}</b>명</span>
                  <span>{query.position} 기용 <b>{result.positionTotal.toLocaleString()}</b>명</span>
                </div>
              )}
            </div>}

            {!hasSearched ? (
              <div className="empty-state"><h4>검색 결과가 없습니다.</h4><p>랭킹과 팀컬러를 선택한 뒤 픽률 조회를 눌러주세요.</p></div>
            ) : loading ? (
              <div className="empty-state"><span>LOADING</span><h4>수집된 데이터를 확인하고 있습니다.</h4></div>
            ) : error ? (
              <div className="empty-state"><span>NO DATA</span><h4>{error}</h4><p>데이터를 임의로 생성하지 않습니다.<br />수집이 완료되면 실제 결과만 표시됩니다.</p></div>
            ) : result && result.items.length > 0 ? (
              <>
                <div className="player-list">
                  {result.items.map((player, index) => (
                    <article className="player-row is-clickable" key={`${player.spid}-${player.grade}`} onClick={() => openPlayerDetail(player)}>
                      <span className="list-rank">{String(index + 1).padStart(2, "0")}</span>
                      <PlayerImage spid={player.spid} name={player.name || "선수"} wrapperClassName="player-photo" />
                      <div className="player-identity">
                        <div><SeasonBadge season={player.season} image={player.seasonImage} /><EnhancementBadge grade={player.grade} /></div>
                        <h4>{player.name || "선수명 정보 없음"}</h4>
                        <p className="player-list-data"><span>OVR <b className={player.ovr != null && player.ovr >= 40 ? `ability-over-${Math.min(150, Math.floor(player.ovr / 10) * 10)}` : undefined}>{player.ovr ?? "정보 없음"}</b></span><span>{player.price ? `${squadPriceLabel(player.price)} BP` : "가격 정보 없음"}</span></p>
                      </div>
                      <div className="pick-meter">
                        <div>
                          <div className="pick-meter-label">
                            <span>사용 {player.count.toLocaleString()}명</span>
                          </div>
                          <div className="pick-meter-value">
                            <b>{player.pickRate.toFixed(2)}%</b>
                            <div className="pick-actions">
                              <button aria-label={`${player.name || "선수"} 상세 보기`} title="선수 상세" type="button" onClick={(event) => { event.stopPropagation(); openPlayerDetail(player); }}>
                                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></svg>
                              </button>
                              <button
                                aria-label={`${player.name || "선수"} 비교 선수로 선택`}
                                aria-pressed={comparisonPlayer?.spid === player.spid && comparisonPlayer?.grade === player.grade}
                                className={comparisonPlayer?.spid === player.spid && comparisonPlayer?.grade === player.grade ? "selected" : ""}
                                title="선수 비교"
                                type="button"
                                onClick={(event) => { event.stopPropagation(); void togglePlayerComparison(player); }}
                              >{comparisonPlayer?.spid === player.spid && comparisonPlayer?.grade === player.grade ? "✓" : "VS"}</button>
                            </div>
                          </div>
                        </div>
                        <div className="meter-track"><i style={{ width: `${player.pickRate}%` }} /></div>
                      </div>
                    </article>
                  ))}
                </div>
                {result.hasMore && (
                  <button className="more-button" type="button" disabled={loadingMore} onClick={() => void fetchPicks(query, result.items.length, true)}>
                    {loadingMore ? "불러오는 중" : "3명 더 보기"}<span>＋</span>
                  </button>
                )}
              </>
            ) : (
              <div className="empty-state"><span>NO RESULT</span><h4>조건에 맞는 선발 데이터가 없습니다.</h4><p>조회 범위 또는 팀컬러와 포지션을 변경해 보세요.</p></div>
            )}
          </div>
        </div>
        </div>
      </section>

      {playerModalMode && <div className="player-detail-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closePlayerModal(); }}>
        <section className={`player-detail-modal mode-${playerModalMode}`} role="dialog" aria-modal="true" aria-label={playerModalMode === "compare" ? "선수 비교" : undefined} aria-labelledby={playerModalMode === "compare" ? undefined : "player-detail-modal-title"}>
          {playerModalMode !== "compare" && <header>
            <div><p>PLAYER DATA</p><h2 id="player-detail-modal-title">{playerModalMode === "compare" ? "선수 비교" : "선수 상세 정보"}</h2></div>
            <button aria-label="선수 정보 닫기" type="button" onClick={closePlayerModal}>×</button>
          </header>}
          {playerModalLoading && !playerModalItems.length ? <div className="player-detail-modal-state"><span>LOADING</span><p>FC온라인 선수 정보를 불러오고 있습니다.</p></div>
            : playerModalError && !playerModalItems.length ? <div className="player-detail-modal-state error"><span>FAILED</span><p>{playerModalError}</p></div>
            : <div className="player-detail-modal-content">
              {playerModalMode === "compare" && playerModalItems.length === 2 ? <PlayerComparePanel left={playerModalItems[0]} right={playerModalItems[1]} onClose={closePlayerModal} /> : playerModalItems[0] && <div className="player-detail-modal-column" key={`${playerModalItems[0].spid}-${playerModalItems[0].grade}`}><PlayerDetailPanel player={playerModalItems[0]} controls={<div className="player-detail-controls">
                <label><span>적응도</span><select aria-label="적응도" value={playerDetailAdaptation} disabled={playerModalLoading} onChange={(event) => changePlayerDetailAdaptation(Number(event.target.value))}>{Array.from({ length: 6 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><span>강화 단계</span><select aria-label="강화 단계" value={playerDetailGrade} disabled={playerModalLoading} onChange={(event) => changePlayerDetailGrade(Number(event.target.value))}>{Array.from({ length: 13 }, (_, index) => index + 1).map((grade) => <option key={grade} value={grade}>+{grade}</option>)}</select></label>
                {(playerModalLoading || playerModalError) && <p aria-live="polite">{playerModalLoading ? "변경 내용을 반영하고 있습니다." : playerModalError}</p>}
              </div>} /></div>}
            </div>}
        </section>
      </div>}</>}

      {showsManagers && <><section className={`user-search-section${!profileLoading && !profileError && !profileResult ? " is-initial" : ""}`} id="user-search">
        <div className="user-search-heading">
          <div><p className="section-kicker">MANAGER PROFILE</p><h2>구단주 검색</h2></div>
        </div>

        <div className="manager-search-panel">
          <form className="profile-search-form" onSubmit={searchProfile}>
            <NicknameAutocomplete id="profile-nickname" label="구단주 닉네임" value={profileNickname} onChange={changeProfileNickname} />
            <button type="submit" disabled={profileLoading}>{profileLoading ? "검색 중" : "검색"}</button>
          </form>

        {profileError ? <div className="profile-empty error">{profileError}</div> : profileLoading ? <div className="profile-empty">구단주 정보를 불러오는 중입니다.</div> : profileResult ? (
          <div className="profile-dashboard">
            <div className="profile-summary manager-profile-summary">
              <div className="manager-summary-identity">
                {profileResult.profile.teamImage ? <span className="manager-summary-emblem" style={{ "--manager-emblem": `url(${JSON.stringify(profileResult.profile.teamImage)})` } as CSSProperties}><img src={profileResult.profile.teamImage} alt="" /></span> : <span className="manager-summary-crest-missing" aria-hidden="true">FC</span>}
                <div><span>{profileResult.profile.rank.toLocaleString()}위</span><h3>{profileResult.profile.nickname}</h3>{liveProfileResult?.level != null && <b>LV {liveProfileResult.level.toLocaleString()}</b>}</div>
                <p>구단 가치 <strong>{clubValueLabel(profileResult.profile.clubValue)}</strong><i aria-hidden="true" />{profileResult.profile.primaryTeamColor || "팀컬러 없음"}</p>
              </div>
              <div className="manager-summary-record-slot" aria-hidden="true" />
              <section className="manager-summary-stat manager-summary-recent"><span>최근 10경기</span><strong>{matches.slice(0, 10).filter((match) => match.self?.result === "승").length}승 {matches.slice(0, 10).filter((match) => match.self?.result === "무").length}무 {matches.slice(0, 10).filter((match) => match.self?.result === "패").length}패 ({matches.slice(0, 10).length ? `${((matches.slice(0, 10).filter((match) => match.self?.result === "승").length / matches.slice(0, 10).length) * 100).toFixed(1)}%` : "0.0%"})</strong><div>{matches.slice(0, 10).map((match) => <i className={`result-${match.self?.result || "없음"}`} key={match.matchId}>{match.self?.result === "승" ? "W" : match.self?.result === "무" ? "D" : "L"}</i>)}</div></section>
              <section className="manager-summary-tier"><span>최고 등급</span>{liveProfileResult?.maxDivision?.divisionImage && <img className="manager-tier-image" src={liveProfileResult.maxDivision.divisionImage} alt="" />}<strong>{liveProfileResult?.maxDivision?.divisionName || "정보 없음"}</strong>{liveProfileResult?.maxDivision?.achievementDate && <small>{liveProfileResult.maxDivision.achievementDate.slice(0, 10)}</small>}</section>
            </div>

            <div className="manager-metrics-action">
              <button type="button">지표 보기</button>
            </div>

            <div className="profile-block">
              <SquadSection nickname={profileResult.profile.nickname} formation={profileResult.profile.formation} squad={profileResult.squad} />
            </div>

            <div className="history-controls">
              <div className="history-toolbar"><HistoryFrameToggle value={historyFrame} onChange={setHistoryFrame} /></div>
              <small className="history-navigation-guide">차트를 좌우로 드래그하거나 휠을 움직이면 이전 기록을 볼 수 있습니다.</small>
            </div>
            <div className="history-grid">
              <HistoryChart title="랭킹 변화" items={aggregateHistory(profileResult.history, historyFrame)} frame={historyFrame} value={(item) => item.rank} format={(item) => `${item.rank.toLocaleString()}위`} formatPoint={(point) => `${Math.round(point).toLocaleString()}위`} change={rankHistoryChange} lowerIsHigher visibleScale minimumScalePadding={0.5} />
              <HistoryChart title="구단가치 변화" items={aggregateHistory(profileResult.history, historyFrame)} frame={historyFrame} value={(item) => historyClubValuePoint(item.clubValue)} format={(item) => clubValueLabel(item.clubValue)} formatPoint={historyClubValueLabel} change={clubValueHistoryChange} visibleScale scalePaddingRatio={0.1} minimumScalePadding={0.1} />
              <HistoryChart title="승률 변화" items={aggregateHistory(profileResult.history, historyFrame)} frame={historyFrame} value={(item) => item.winRate} format={(item) => item.winRate == null ? "정보 없음" : `${item.winRate.toFixed(1)}%`} formatPoint={(point) => `${point.toFixed(1)}%`} change={winRateHistoryChange} visibleScale minimumScalePadding={0.1} />
            </div>

            <div className="profile-block match-block">
              <div className="profile-block-heading"><div><span>RECENT MATCHES</span><h3>최근 경기</h3><p className="manager-match-record">{integerLabel(profileResult.profile.wins)}승 {integerLabel(profileResult.profile.draws)}무 {integerLabel(profileResult.profile.losses)}패({profileResult.profile.winRate == null ? "정보 없음" : `${profileResult.profile.winRate.toFixed(1)}%`})</p></div></div>
              <div className={`matches-layout${selectedMatch ? " detail-open" : ""}`}>
                <div className="match-list">
                  {matches.length === 0 && !matchesLoading ? <div className="profile-empty">최근 감독모드 경기가 없습니다.</div> : matches.map((match) => (
                    <button className={selectedMatch?.matchId === match.matchId ? "selected" : ""} type="button" key={match.matchId} onClick={() => setSelectedMatch(match)}>
                      <span className={`match-result result-${match.self?.result || "없음"}`}>{match.self?.result || "결과 없음"}</span>
                      <div><b>{match.self?.nickname || profileResult.profile.nickname} {match.self?.score ?? 0} : {match.opponent?.score ?? 0} {match.opponent?.nickname || "상대 정보 없음"}</b><small>{String(match.matchDate || "").replace("T", " ").slice(0, 16)}</small></div>
                    </button>
                  ))}
                  {matchesHasMore && <button className="matches-more" type="button" disabled={matchesLoading} onClick={() => void loadRecentMatches(profileResult.profile.nickname, matches.length, true)}>{matchesLoading ? "불러오는 중" : "20경기 더 보기"}</button>}
                </div>
                <div className="match-detail">
                  {selectedMatch?.self && selectedMatch.opponent ? <>
                    <div className="match-score"><span>{selectedMatch.self.nickname}</span><strong>{selectedMatch.self.score} : {selectedMatch.opponent.score}</strong><span>{selectedMatch.opponent.nickname}</span></div>
                    {[
                      ["점유율", `${selectedMatch.self.possession}%`, `${selectedMatch.opponent.possession}%`],
                      ["슈팅", selectedMatch.self.shots, selectedMatch.opponent.shots],
                      ["유효 슈팅", selectedMatch.self.effectiveShots, selectedMatch.opponent.effectiveShots],
                      ["패스 성공", `${selectedMatch.self.passSuccess}/${selectedMatch.self.passTry}`, `${selectedMatch.opponent.passSuccess}/${selectedMatch.opponent.passTry}`],
                      ["파울", selectedMatch.self.fouls, selectedMatch.opponent.fouls],
                      ["코너킥", selectedMatch.self.corners, selectedMatch.opponent.corners],
                    ].map(([label, selfValue, opponentValue]) => <div className="match-stat" key={String(label)}><b>{selfValue}</b><span>{label}</span><b>{opponentValue}</b></div>)}
                  </> : <div className="profile-empty">경기를 선택하면 상세 내용이 표시됩니다.</div>}
                </div>
              </div>
            </div>
          </div>
        ) : liveProfileResult ? (
          <div className="profile-dashboard">
            <div className="profile-summary manager-profile-summary">
              <div className="manager-summary-identity">
                <span className="manager-summary-crest-missing" aria-hidden="true">FC</span>
                <div><span>랭킹 정보 없음</span><h3>{liveProfileResult.nickname}</h3>{liveProfileResult.level != null && <b>LV {liveProfileResult.level.toLocaleString()}</b>}</div>
                <p>구단 가치 <strong>{liveProfileResult.squad?.totalPrice == null ? "정보 없음" : `${liveProfileResult.squad.totalPrice.toLocaleString()} BP`}</strong></p>
              </div>
              <div className="manager-summary-record-slot" aria-hidden="true" />
              <section className="manager-summary-stat manager-summary-recent"><span>최근 10경기</span><strong>경기 정보 없음</strong></section>
              <section className="manager-summary-tier"><span>최고 등급</span>{liveProfileResult.maxDivision?.divisionImage && <img className="manager-tier-image" src={liveProfileResult.maxDivision.divisionImage} alt="" />}<strong>{liveProfileResult.maxDivision?.divisionName || "정보 없음"}</strong>{liveProfileResult.maxDivision?.achievementDate && <small>{liveProfileResult.maxDivision.achievementDate.slice(0, 10)}</small>}</section>
            </div>
          </div>
        ) : <div className="profile-empty">구단주를 검색하면 저장된 정보와 최근 경기가 표시됩니다.</div>}
        </div>
      </section>

      <ResponsiveAd label="구단주 검색 다음 광고" /></>}

      {showsRanking && <><section className="ranking-section" id="ranking">
        <nav className="meta-ranking-tabs ranking-category-tabs" role="tablist" aria-label="랭킹 선택">
          <button type="button" role="tab" aria-selected={rankingCategory === "managers"} className={rankingCategory === "managers" ? "is-active" : ""} onClick={() => selectRankingCategory("managers")}>감독모드 랭킹</button>
          <button type="button" role="tab" aria-selected={rankingCategory === "formations"} className={rankingCategory === "formations" ? "is-active" : ""} onClick={() => selectRankingCategory("formations")}>포메이션 랭킹</button>
          <button type="button" role="tab" aria-selected={rankingCategory === "team-colors"} className={rankingCategory === "team-colors" ? "is-active" : ""} onClick={() => selectRankingCategory("team-colors")}>팀컬러 랭킹</button>
        </nav>
        {rankingCategory === "managers" ? <>
        <div className="ranking-heading">
          <div>
            <p className="section-kicker">MANAGER MODE RANKING</p>
            <h2>감독모드 랭킹</h2>
            <p className="ranking-description">FC 온라인 감독모드 상위 10,000명의 랭킹과 팀 정보를 확인하세요.</p>
          </div>
          <div className="ranking-controls">
            <form className="ranking-search" onSubmit={searchRanking}>
              <NicknameAutocomplete id="ranking-nickname" label="구단주 닉네임 검색" value={rankingNickname} onChange={setRankingNickname} clearable onClear={() => void fetchRankings(rankingTeam, 1)} />
            </form>
            <div className="ranking-filter">
              <TeamAutocomplete id="ranking-team-color" label="팀컬러 필터" value={rankingTeam} options={teamColorNames} onChange={setRankingTeam} onSelect={(nextTeam) => { setRankingNickname(""); void fetchRankings(nextTeam, 1); }} clearable onClear={() => { setRankingNickname(""); void fetchRankings("", 1); }} />
            </div>
          </div>
        </div>

        <div className="ranking-board">
          <div className="ranking-board-meta">
            <span>{rankingSearchActive ? `NICKNAME · ${rankingSearchLabel}` : rankingTeam || "ALL TEAM COLORS"}</span>
            <p>{rankingResult ? `${rankingResult.total.toLocaleString()}명 · ${simpleSnapshotLabel(rankingResult.snapshot.data_time)}` : "데이터 없음"}</p>
          </div>
          <div className="ranking-table-head" aria-hidden="true">
            <span>랭킹</span><span>구단주</span><span>팀컬러</span><span>포메이션</span><span>점수</span><span>승률</span><span>구단가치</span>
          </div>

          {rankingLoading ? (
            <div className="ranking-empty">실제 랭킹을 불러오는 중입니다.</div>
          ) : rankingError ? (
            <div className="ranking-empty error">{rankingError}</div>
          ) : rankingResult && rankingResult.items.length > 0 ? (
            <div className="ranking-list">
              {rankingResult.items.map((ranker) => (
                <article
                  className={`ranking-row ${ranker.rank <= 3 ? "podium" : ""}`}
                  key={`${ranker.rank}-${ranker.nexonSn}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${ranker.nickname} 구단주 정보 보기`}
                  onClick={() => void openRankerModal(ranker)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openRankerModal(ranker);
                    }
                  }}
                >
                  <strong className="ranking-number">{integerLabel(ranker.rank, 2)}<RankDelta current={ranker.rank} previous={ranker.previousRank} /></strong>
                  <div className="ranking-coach">
                    <h3>{ranker.nickname}</h3>
                    <span>LV. {ranker.level?.toLocaleString() ?? "정보 없음"}</span>
                  </div>
                  <div className="ranking-team">
                    {ranker.teamImage ? <img src={ranker.teamImage} alt="" /> : <span className="team-image-missing" aria-label="팀 마크 없음" />}
                    <div><b>{ranker.primaryTeamColor || "팀컬러 없음"}</b><small>{ranker.teamColorCount ? `${ranker.teamColorCount}명 적용` : "적용 인원 없음"}</small></div>
                  </div>
                  <span className="ranking-formation">{ranker.formation || "—"}</span>
                  <strong className="ranking-elo">{ranker.elo?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? "—"}</strong>
                  <div className="ranking-record"><b>{ranker.winRate == null ? "—" : `${ranker.winRate.toFixed(1)}%`}</b><WinRateDelta current={ranker.winRate} previous={ranker.previousWinRate} /><small>{integerLabel(ranker.wins)}승 {integerLabel(ranker.draws)}무 {integerLabel(ranker.losses)}패</small></div>
                  <span className="ranking-value">{clubValueLabel(ranker.clubValue)}<ClubValueDelta current={ranker.clubValue} previous={ranker.previousClubValue} /></span>
                </article>
              ))}
            </div>
          ) : (
            <div className="ranking-empty">조건에 맞는 실제 랭킹 데이터가 없습니다.</div>
          )}
          {!rankingSearchActive && rankingResult && rankingResult.total > 0 && (
            <nav className="ranking-pagination" aria-label="랭킹 페이지">
              <button type="button" disabled={rankingLoading || rankingPage === 1} onClick={() => void fetchRankings(rankingTeam, rankingPage - 1, true)}>이전</button>
              <div>
                {paginationItems(rankingPage, Math.ceil(rankingResult.total / rankingPageSize)).map((item, index) =>
                  item === "ellipsis" ? <span key={`ellipsis-${index}`}>···</span> : (
                    <button
                      className={rankingPage === item ? "current" : ""}
                      type="button"
                      key={item}
                      disabled={rankingLoading}
                      aria-current={rankingPage === item ? "page" : undefined}
                      onClick={() => void fetchRankings(rankingTeam, item, true)}
                    >{item}</button>
                  ),
                )}
              </div>
              <button type="button" disabled={rankingLoading || rankingPage === Math.ceil(rankingResult.total / rankingPageSize)} onClick={() => void fetchRankings(rankingTeam, rankingPage + 1, true)}>다음</button>
            </nav>
          )}
        </div>
        </> : <MetaRankingContent activeTab={rankingCategory} />}
      </section>

      {rankingCategory === "managers" ? <ResponsiveAd label="랭킹 다음 광고" /> : null}

      {modalNickname && (
        <div className="ranker-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRankerModal(); }}>
          <section className="ranker-modal" role="dialog" aria-modal="true" aria-labelledby="ranker-modal-title">
            <header className="ranker-modal-header">
              <div><span>MANAGER PROFILE</span><h2 id="ranker-modal-title">{modalNickname}</h2></div>
              <button type="button" onClick={closeRankerModal} aria-label="구단주 정보 닫기">×</button>
            </header>
            <nav className="ranker-modal-tabs" aria-label="구단주 상세 정보">
              {([['summary', '요약'], ['squad', '선발 스쿼드'], ['matches', '최근 경기']] as const).map(([tab, label]) => (
                <button type="button" className={modalTab === tab ? "active" : ""} aria-pressed={modalTab === tab} key={tab} onClick={() => setModalTab(tab)}>{label}</button>
              ))}
            </nav>
            <div className="ranker-modal-body">
              {modalLoading && !modalProfile ? <div className="modal-state">구단주 정보를 불러오는 중입니다.</div> : modalError ? <div className="modal-state error">{modalError}</div> : modalProfile ? (
                <>
                  {modalTab === "summary" && (
                    <div className="modal-summary-tab">
                      <div className="modal-manager-summary">
                        <div><span>{modalProfile.profile.rank.toLocaleString()}위</span><h3>{modalProfile.profile.nickname}</h3><p>{modalProfile.profile.primaryTeamColor || "팀컬러 없음"} · {modalProfile.profile.formation || "포메이션 정보 없음"}</p></div>
                        <dl>
                          <div><dt>구단가치</dt><dd>{clubValueLabel(modalProfile.profile.clubValue)}</dd></div>
                          <div><dt>최근 승률</dt><dd>{modalProfile.profile.winRate == null ? "정보 없음" : `${modalProfile.profile.winRate.toFixed(1)}%`}</dd></div>
                          <div><dt>경기 기록</dt><dd>{integerLabel(modalProfile.profile.wins)}승 {integerLabel(modalProfile.profile.draws)}무 {integerLabel(modalProfile.profile.losses)}패</dd></div>
                          <div><dt>점수</dt><dd>{modalProfile.profile.elo?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? "정보 없음"}</dd></div>
                        </dl>
                      </div>
                      <div className="history-toolbar"><span>기록 조회 단위</span><HistoryFrameToggle value={modalHistoryFrame} onChange={setModalHistoryFrame} /></div>
                      <small className="history-navigation-guide">차트를 좌우로 드래그하거나 휠을 움직이면 이전 기록을 볼 수 있습니다.</small>
                      <div className="history-grid">
                        <HistoryChart title="랭킹 변화" items={aggregateHistory(modalProfile.history, modalHistoryFrame)} frame={modalHistoryFrame} value={(item) => item.rank} format={(item) => `${item.rank.toLocaleString()}위`} formatPoint={(point) => `${Math.round(point).toLocaleString()}위`} change={rankHistoryChange} lowerIsHigher visibleScale minimumScalePadding={0.5} />
                        <HistoryChart title="구단가치 변화" items={aggregateHistory(modalProfile.history, modalHistoryFrame)} frame={modalHistoryFrame} value={(item) => historyClubValuePoint(item.clubValue)} format={(item) => clubValueLabel(item.clubValue)} formatPoint={historyClubValueLabel} change={clubValueHistoryChange} visibleScale scalePaddingRatio={0.1} minimumScalePadding={0.1} />
                        <HistoryChart title="승률 변화" items={aggregateHistory(modalProfile.history, modalHistoryFrame)} frame={modalHistoryFrame} value={(item) => item.winRate} format={(item) => item.winRate == null ? "정보 없음" : `${item.winRate.toFixed(1)}%`} formatPoint={(point) => `${point.toFixed(1)}%`} change={winRateHistoryChange} visibleScale minimumScalePadding={0.1} />
                      </div>
                    </div>
                  )}
                  {modalTab === "squad" && (
                    <div className="modal-content-block">
                      <SquadSection nickname={modalProfile.profile.nickname} formation={modalProfile.profile.formation} squad={modalProfile.squad} emptyClassName="modal-state" />
                    </div>
                  )}
                  {modalTab === "matches" && (
                    <div className={`modal-content-block matches-layout${modalSelectedMatch ? " detail-open" : ""}`}>
                      <div className="match-list">
                        {modalMatches.length > 0 ? modalMatches.map((match) => (
                          <button className={modalSelectedMatch?.matchId === match.matchId ? "selected" : ""} type="button" key={match.matchId} onClick={() => setModalSelectedMatch(match)}>
                            <span className={`match-result result-${match.self?.result || "없음"}`}>{match.self?.result || "결과 없음"}</span>
                            <div><b>{match.self?.nickname || modalNickname} {match.self?.score ?? 0} : {match.opponent?.score ?? 0} {match.opponent?.nickname || "상대 정보 없음"}</b><small>{String(match.matchDate || "").replace("T", " ").slice(0, 16)}</small></div>
                          </button>
                        )) : <div className="modal-state">최근 감독모드 경기가 없습니다.</div>}
                      </div>
                      <div className="match-detail">
                        {modalSelectedMatch?.self && modalSelectedMatch.opponent ? <>
                          <div className="match-score"><span>{modalSelectedMatch.self.nickname}</span><strong>{modalSelectedMatch.self.score} : {modalSelectedMatch.opponent.score}</strong><span>{modalSelectedMatch.opponent.nickname}</span></div>
                          {[["점유율", `${modalSelectedMatch.self.possession}%`, `${modalSelectedMatch.opponent.possession}%`], ["슈팅", modalSelectedMatch.self.shots, modalSelectedMatch.opponent.shots], ["유효 슈팅", modalSelectedMatch.self.effectiveShots, modalSelectedMatch.opponent.effectiveShots], ["패스 성공", `${modalSelectedMatch.self.passSuccess}/${modalSelectedMatch.self.passTry}`, `${modalSelectedMatch.opponent.passSuccess}/${modalSelectedMatch.opponent.passTry}`], ["파울", modalSelectedMatch.self.fouls, modalSelectedMatch.opponent.fouls], ["코너킥", modalSelectedMatch.self.corners, modalSelectedMatch.opponent.corners]].map(([label, selfValue, opponentValue]) => <div className="match-stat" key={String(label)}><b>{selfValue}</b><span>{label}</span><b>{opponentValue}</b></div>)}
                        </> : <div className="profile-empty">경기를 선택하면 상세 내용이 표시됩니다.</div>}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}</>}

      {showsFaq && <section className="faq-section" id="support">
        <div className="faq-heading">
          <p className="section-kicker">SUPPORT / FAQ</p>
          <h2>자주 묻는 질문</h2>
        </div>
        <div className="faq-list">
          <details><summary>게임 닉네임은 다른 사람에게 공개되나요?</summary><p>회원가입 때 공개 여부를 직접 선택합니다. 비공개로 설정하면 본인과 운영자만 확인할 수 있습니다.</p></details>
          <details><summary>로그인에 문제가 있어요.</summary><p>FC-SUPPORT는 Google 로그인만 사용합니다. Google 계정 접근이나 복구가 필요한 경우 Google 계정 고객센터에서 확인해 주세요.</p></details>
          <details><summary>데이터가 실제 게임과 다르게 보여요.</summary><p>NEXON Open API와 수집 시점에 따라 반영이 늦거나 일부 기록이 없을 수 있습니다. 오류는 고객센터 이메일로 알려주세요.</p></details>
        </div>
        <div className="faq-contact-actions">
          <a className="faq-contact-link" href="/community?compose=inquiry">사이트에서 문의·건의 남기기</a>
          <a className="faq-contact-link faq-contact-link-secondary" href="mailto:fc-support@naver.com?subject=FC-SUPPORT 문의·건의">이메일로 문의하기 · fc-support@naver.com</a>
        </div>
      </section>}

      {/* Previous home-only footer retained but disabled.
        <footer className="site-footer">
          <div className="footer-frame">
            <div className="footer-frame-head">
              <a className="brand footer-brand" href="#top" aria-label="FC-SUPPORT 홈으로"><span className="brand-mark">FC</span><span>SUPPORT</span></a>
              <span><i /> NEXON OPEN API DATA</span>
            </div>
            <div className="footer-main-copy">
              <p className="footer-index">FC / 01</p>
              <h2>감독모드의 흐름을<br />데이터로 읽습니다.</h2>
              <p>NEXON Open API 데이터를 바탕으로 랭킹, 스쿼드와 경기 정보를 정리합니다.</p>
            </div>
            <nav className="footer-links" aria-label="하단 운영 메뉴">
              <a href="/privacy"><span>01</span><b>개인정보처리방침</b></a>
              <a href="/terms"><span>02</span><b>이용약관</b></a>
              <a href="/community?compose=inquiry"><span>03</span><b>게시물 신고·운영 문의</b></a>
            <a href="/faq"><span>04</span><b>FAQ · 문의 · 건의</b></a>
            </nav>
            <div className="footer-contact">
              <span>CONTACT · PREPARING</span>
              <strong>fc-support@naver.com</strong>
            </div>
            <div className="footer-legal">
              <p>FC-SUPPORT는 ㈜넥슨코리아의 공식 서비스가 아닙니다. 본 사이트는 NEXON Open API를 사용하며, API·관련 상표·제공 데이터의 저작권 등 제반 권리는 ㈜넥슨코리아 또는 정당한 권리자에게 있습니다.</p>
            </div>
            <div className="footer-bottom"><small>© {new Date().getFullYear()} FC-SUPPORT · DATA BASED ON NEXON OPEN API</small><a href="/">BACK TO TOP ↑</a></div>
          </div>
        </footer>
      */}
      <SiteFooter />
    </main>
  );
}
