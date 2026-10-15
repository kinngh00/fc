"use client";

import { FormEvent, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  PlayerComparePanel,
  PlayerMarketChart,
  type PlayerDetail as SharedPlayerDetail,
} from "../page";
import { SiteFooter, SiteHeader } from "../site-chrome";

const apiBaseUrl =
  typeof window === "undefined"
    ? process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr"
    : "";

type PlayerSearchItem = {
  spid: string;
  pid: string;
  seasonId: number;
  name: string;
  season: string | null;
  seasonImage: string | null;
  nation: string | null;
  nationImage: string | null;
  image: string | null;
  ovr: number | null;
  price: string | null;
};
type PlayerDetail = SharedPlayerDetail;

export default function PlayersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchItem[]>([]);
  const [selected, setSelected] = useState<PlayerSearchItem | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [comparisonPlayer, setComparisonPlayer] =
    useState<PlayerSearchItem | null>(null);
  const [comparisonItems, setComparisonItems] = useState<PlayerDetail[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [grade, setGrade] = useState(1);
  const [searchGrade, setSearchGrade] = useState(1);
  const [searchAdaptation, setSearchAdaptation] = useState(1);
  const [searchTeamColorLevel, setSearchTeamColorLevel] = useState(0);
  const [resultGrades, setResultGrades] = useState<Record<string, number>>({});
  const [updatingResultSpid, setUpdatingResultSpid] = useState<string | null>(
    null,
  );
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const comparisonRequestVersion = useRef(0);
  const marketRef = useRef<HTMLElement | null>(null);
  const [marketHeight, setMarketHeight] = useState<number | null>(null);
  const hasSearchResults = searched && results.length > 0;
  const hasPlayerSelection =
    selected !== null || comparisonLoading || comparisonItems.length === 2;
  const supplementStyle = marketHeight
    ? ({ "--player-detail-market-height": `${marketHeight}px` } as CSSProperties)
    : undefined;

  useEffect(() => {
    const market = marketRef.current;
    if (!market) return;
    const updateHeight = () => setMarketHeight(Math.ceil(market.getBoundingClientRect().height));
    const observer = new ResizeObserver(updateHeight);
    observer.observe(market);
    updateHeight();
    return () => observer.disconnect();
  }, [detail?.market]);

  function formatPrice(value: string | null) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "가격 정보 없음";
    if (amount >= 100_000_000)
      return `${(amount / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억 BP`;
    if (amount >= 10_000)
      return `${Math.floor(amount / 10_000).toLocaleString("ko-KR")}만 BP`;
    return `${amount.toLocaleString("ko-KR")} BP`;
  }

  function renderSkillMoves(value: string | null) {
    const filled = value?.match(/★/g)?.length ?? 0;
    const total = value?.match(/[★☆]/g)?.length ?? 0;
    return total ? (
      <span className="skill-moves-rating" aria-label={`${filled}/${total}`}>
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={index < filled ? "filled" : "empty"}>
            ★
          </span>
        ))}
      </span>
    ) : (
      "정보 없음"
    );
  }

  function renderFoot(value: string | null, strongValue: string | null) {
    if (!value) return "정보 없음";
    const strongIndex = strongValue ? value.indexOf(strongValue) : -1;
    return (
      <span className="foot-label">
        {strongIndex >= 0 ? (
          <>
            {value.slice(0, strongIndex)}
            <strong>{strongValue}</strong>
            {value.slice(strongIndex + strongValue!.length)}
          </>
        ) : (
          value
        )}
      </span>
    );
  }

  async function requestSearch(
    name: string,
    nextGrade = searchGrade,
    nextAdaptation = searchAdaptation,
    nextTeamColorLevel = searchTeamColorLevel,
  ) {
    const names = name
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!names.length) return;
    comparisonRequestVersion.current += 1;
    setSearching(true);
    setSearched(true);
    setError("");
    setSelected(null);
    setDetail(null);
    setComparisonPlayer(null);
    setComparisonItems([]);
    setComparisonLoading(false);
    try {
      const payloads = await Promise.all(
        names.map(async (searchName) => {
          const params = new URLSearchParams({
            query: searchName,
            limit: "18",
            grade: String(nextGrade),
            adaptation: String(nextAdaptation),
            teamColorLevel: String(nextTeamColorLevel),
          });
          const response = await fetch(
            `${apiBaseUrl}/api/players/search?${params}`,
            { cache: "no-store" },
          );
          const payload = await response.json();
          if (!response.ok)
            throw new Error(payload.message || "선수 검색에 실패했습니다.");
          return Array.isArray(payload.items)
            ? (payload.items as PlayerSearchItem[])
            : [];
        }),
      );
      const seen = new Set<string>();
      setResults(
        payloads
          .flat()
          .filter(
            (player) => !seen.has(player.spid) && (seen.add(player.spid), true),
          )
          .sort((left, right) => right.ovr - left.ovr),
      );
    } catch (searchError) {
      setResults([]);
      setError(
        searchError instanceof Error
          ? searchError.message
          : "선수 검색에 실패했습니다.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const name = query.trim();
    if (!name) return;
    await requestSearch(name);
  }

  function updateSearchOptions(
    nextGrade: number,
    nextAdaptation: number,
    nextTeamColorLevel: number,
  ) {
    setSearchGrade(nextGrade);
    setSearchAdaptation(nextAdaptation);
    setSearchTeamColorLevel(nextTeamColorLevel);
    const name = query.trim();
    if (searched && name)
      void requestSearch(name, nextGrade, nextAdaptation, nextTeamColorLevel);
  }

  async function updateResultGrade(
    player: PlayerSearchItem,
    nextGrade: number,
  ) {
    const playerName = player.name.trim();
    if (!playerName || nextGrade === (resultGrades[player.spid] ?? searchGrade))
      return;
    setUpdatingResultSpid(player.spid);
    setError("");
    try {
      const params = new URLSearchParams({
        query: playerName,
        limit: "30",
        grade: String(nextGrade),
        adaptation: String(searchAdaptation),
        teamColorLevel: String(searchTeamColorLevel),
      });
      const response = await fetch(
        `${apiBaseUrl}/api/players/search?${params}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message || "선수 강화 단계 정보를 불러오지 못했습니다.",
        );
      const updated = Array.isArray(payload.items)
        ? payload.items.find(
            (item: PlayerSearchItem) => item.spid === player.spid,
          )
        : null;
      if (!updated) throw new Error("선수 강화 단계 정보를 찾지 못했습니다.");
      setResultGrades((current) => ({ ...current, [player.spid]: nextGrade }));
      setResults((current) =>
        current.map((item) => (item.spid === player.spid ? updated : item)),
      );
      if (selected?.spid === player.spid)
        void loadDetail(
          updated,
          nextGrade,
          searchAdaptation,
          searchTeamColorLevel,
        );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "선수 강화 단계 정보를 불러오지 못했습니다.",
      );
    } finally {
      setUpdatingResultSpid(null);
    }
  }

  async function fetchDetail(
    player: Pick<PlayerSearchItem, "spid">,
    nextGrade = searchGrade,
    nextAdaptation = searchAdaptation,
    nextTeamColorLevel = searchTeamColorLevel,
  ) {
    const params = new URLSearchParams({
      spid: player.spid,
      grade: String(nextGrade),
      adaptation: String(nextAdaptation),
      teamColorLevel: String(nextTeamColorLevel),
    });
    const response = await fetch(
      `${apiBaseUrl}/api/players/details?${params}`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok || !payload.player)
      throw new Error(payload.message || "선수 정보를 불러오지 못했습니다.");
    return payload.player as PlayerDetail;
  }

  async function loadDetail(
    player: PlayerSearchItem,
    nextGrade = searchGrade,
    nextAdaptation = searchAdaptation,
    nextTeamColorLevel = searchTeamColorLevel,
  ) {
    setSelected(player);
    setGrade(nextGrade);
    setLoadingDetail(true);
    setError("");
    try {
      setDetail(
        await fetchDetail(
          player,
          nextGrade,
          nextAdaptation,
          nextTeamColorLevel,
        ),
      );
    } catch (detailError) {
      setDetail(null);
      setError(
        detailError instanceof Error
          ? detailError.message
          : "선수 정보를 불러오지 못했습니다.",
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  function openStandaloneDetail(
    player: PlayerSearchItem,
    nextGrade = searchGrade,
  ) {
    comparisonRequestVersion.current += 1;
    setComparisonPlayer(null);
    setComparisonItems([]);
    setComparisonLoading(false);
    void loadDetail(player, nextGrade, searchAdaptation, searchTeamColorLevel);
  }

  async function toggleComparison(player: PlayerSearchItem) {
    if (comparisonItems.length === 2) {
      comparisonRequestVersion.current += 1;
      setComparisonItems([]);
      setComparisonLoading(false);
      setComparisonPlayer(player);
      return;
    }
    if (!comparisonPlayer) {
      setComparisonPlayer(player);
      return;
    }
    if (comparisonPlayer.spid === player.spid) {
      setComparisonPlayer(null);
      return;
    }
    const requestVersion = ++comparisonRequestVersion.current;
    setComparisonLoading(true);
    setError("");
    try {
      const items = await Promise.all([
        fetchDetail(comparisonPlayer),
        fetchDetail(player),
      ]);
      if (comparisonRequestVersion.current === requestVersion)
        setComparisonItems(items);
    } catch (comparisonError) {
      if (comparisonRequestVersion.current === requestVersion) {
        setError(
          comparisonError instanceof Error
            ? comparisonError.message
            : "선수 비교 정보를 불러오지 못했습니다.",
        );
      }
    } finally {
      if (comparisonRequestVersion.current === requestVersion) {
        setComparisonLoading(false);
        setComparisonPlayer(null);
      }
    }
  }

  async function updateComparisonGrade(
    player: PlayerDetail,
    nextGrade: number,
  ) {
    if (player.grade === nextGrade) return;
    setComparisonLoading(true);
    setError("");
    try {
      const updated = await fetchDetail(
        player,
        nextGrade,
        searchAdaptation,
        searchTeamColorLevel,
      );
      setComparisonItems((current) =>
        current.map((item) => (item.spid === player.spid ? updated : item)),
      );
    } catch (comparisonError) {
      setError(
        comparisonError instanceof Error
          ? comparisonError.message
          : "선수 강화 단계 정보를 불러오지 못했습니다.",
      );
    } finally {
      setComparisonLoading(false);
    }
  }

  return (
    <main
      className={`players-page${hasSearchResults ? " has-search-results" : ""}`}
    >
      <SiteHeader active="players" />
      <section className="players-catalog">
        <header className="players-catalog-heading">
          <div>
            <p className="section-kicker">PLAYER DATABASE</p>
            <h1>선수</h1>
          </div>
        </header>

        <div
          className={`players-catalog-layout${hasSearchResults ? " has-search-results" : ""}${hasPlayerSelection ? " has-player-selection" : ""}`}
        >
          <div
            className="player-section-title player-profile-title"
            role="search"
            aria-label="선수 검색"
          >
            <form id="player-search-form" onSubmit={search} />
            <label className="player-profile-search-field">
              <span>강화</span>
              <select
                form="player-search-form"
                aria-label="강화"
                value={searchGrade}
                onChange={(event) =>
                  updateSearchOptions(
                    Number(event.target.value),
                    searchAdaptation,
                    searchTeamColorLevel,
                  )
                }
              >
                {Array.from({ length: 13 }, (_, index) => (
                  <option value={index + 1} key={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="player-profile-search-field">
              <span>적응도</span>
              <select
                form="player-search-form"
                aria-label="적응도"
                value={searchAdaptation}
                onChange={(event) =>
                  updateSearchOptions(
                    searchGrade,
                    Number(event.target.value),
                    searchTeamColorLevel,
                  )
                }
              >
                {Array.from({ length: 6 }, (_, value) => (
                  <option value={value} key={value}>
                    +{value}
                  </option>
                ))}
              </select>
            </label>
            <label className="player-profile-search-field">
              <span>팀컬러</span>
              <select
                form="player-search-form"
                aria-label="팀컬러"
                value={searchTeamColorLevel}
                onChange={(event) =>
                  updateSearchOptions(
                    searchGrade,
                    searchAdaptation,
                    Number(event.target.value),
                  )
                }
              >
                {Array.from({ length: 10 }, (_, value) => (
                  <option value={value} key={value}>
                    {value ? `+${value}` : "0"}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="player-profile-search-field player-profile-search-name"
              htmlFor="player-name"
            >
              <span>선수 이름</span>
              <input
                form="player-search-form"
                id="player-name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="선수명 입력"
                autoComplete="off"
              />
            </label>
            <button
              className="player-profile-search-button"
              form="player-search-form"
              type="submit"
              disabled={searching}
            >
              {searching ? "검색 중" : "검색"}
            </button>
          </div>
          <section className="player-search-results" aria-live="polite">
            {!searched ? (
              <div className="players-empty players-empty-initial">
                <p>찾고 싶은 선수 이름을 입력해 주세요.</p>
              </div>
            ) : searching ? (
              <div className="players-empty">
                <span>LOADING</span>
                <p>선수 데이터를 검색하고 있습니다.</p>
              </div>
            ) : results.length ? (
              <div className="player-search-list">
                {results.map((player) => (
                  <article
                    className={selected?.spid === player.spid ? "selected" : ""}
                    key={player.spid}
                    onClick={() =>
                      openStandaloneDetail(
                        player,
                        resultGrades[player.spid] ?? searchGrade,
                      )
                    }
                  >
                    <span className="player-search-image">
                      {player.image ? (
                        <img src={player.image} alt="" />
                      ) : (
                        <span>NO IMAGE</span>
                      )}
                    </span>
                    <span className="player-search-copy">
                      <span className="player-search-primary">
                        <b>{player.name}</b>
                      </span>
                      <span className="player-search-meta">
                        <span className="player-search-stats">
                          <strong>
                            OVR{" "}
                            <b
                              className={
                                player.ovr != null && player.ovr >= 40
                                  ? `ability-over-${Math.min(150, Math.floor(player.ovr / 10) * 10)}`
                                  : undefined
                              }
                            >
                              {player.ovr ?? "—"}
                            </b>
                          </strong>
                          <em>{formatPrice(player.price)}</em>
                        </span>
                        <span className="player-search-controls">
                          <select
                            className="player-search-grade"
                            aria-label={`${player.name} 강화 단계`}
                            title="강화 단계"
                            value={resultGrades[player.spid] ?? searchGrade}
                            disabled={updatingResultSpid === player.spid}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              event.stopPropagation();
                              void updateResultGrade(
                                player,
                                Number(event.target.value),
                              );
                            }}
                          >
                            {Array.from({ length: 13 }, (_, index) => (
                              <option value={index + 1} key={index + 1}>
                                +{index + 1}
                              </option>
                            ))}
                          </select>
                          <span
                            className="player-search-season"
                            aria-label={player.season || "시즌 정보 없음"}
                            data-tooltip={player.season || "시즌 정보 없음"}
                          >
                            {player.seasonImage ? (
                              <img src={player.seasonImage} alt="" />
                            ) : (
                              "FC"
                            )}
                          </span>
                          {player.nationImage ? (
                            <button
                              className="player-search-nation"
                              aria-label={player.nation || "국가 정보 없음"}
                              data-tooltip={player.nation || "국가 정보 없음"}
                              type="button"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <img src={player.nationImage} alt="" />
                            </button>
                          ) : null}
                        </span>
                      </span>
                    </span>
                    <span className="player-search-actions">
                      <button
                        aria-label={`${player.name} 비교 선수로 선택`}
                        aria-pressed={comparisonPlayer?.spid === player.spid}
                        className={`${comparisonPlayer?.spid === player.spid ? "selected" : ""}${comparisonItems.some((item) => item.spid === player.spid) ? " is-comparing" : ""}`.trim()}
                        title="선수 비교"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleComparison(player);
                        }}
                      >
                        {comparisonPlayer?.spid === player.spid ? "✓" : "VS"}
                      </button>
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="players-empty">
                <span>NO RESULT</span>
                <p>검색한 이름과 일치하는 선수가 없습니다.</p>
              </div>
            )}
          </section>

          <section className="player-profile-view" aria-live="polite">
            {error ? (
              <div className="players-empty error">
                <span>FAILED</span>
                <p>{error}</p>
              </div>
            ) : loadingDetail ? (
              <div className="players-empty">
                <span>LOADING</span>
                <p>선수 상세 정보를 불러오고 있습니다.</p>
              </div>
            ) : comparisonLoading ? (
              <div className="players-empty">
                <span>LOADING</span>
                <p>선수 비교 정보를 불러오고 있습니다.</p>
              </div>
            ) : comparisonItems.length === 2 ? (
              <article className="player-profile-card player-profile-compare-inline">
                <PlayerComparePanel
                  left={comparisonItems[0]}
                  right={comparisonItems[1]}
                  onGradeChange={updateComparisonGrade}
                  showClose={false}
                />
              </article>
            ) : detail ? (
              <article className="player-profile-card">
                <div className="player-profile-main">
                  <div className="player-profile-image">
                    {detail.image ? (
                      <img src={detail.image} alt={`${detail.name} 선수`} />
                    ) : (
                      <span>NO IMAGE</span>
                    )}
                  </div>
                  <div className="player-profile-copy">
                    <h3>{detail.name}</h3>
                    <div className="player-profile-numbers">
                      <span>
                        <small>OVR</small>
                        <b
                          className={
                            detail.ovr != null && detail.ovr >= 40
                              ? `ability-over-${Math.min(150, Math.floor(detail.ovr / 10) * 10)}`
                              : undefined
                          }
                        >
                          {detail.ovr ?? "—"}
                        </b>
                      </span>
                      <span>
                        <small>급여</small>
                        <b>{detail.pay ?? "—"}</b>
                      </span>
                    </div>
                    <hr className="player-profile-badge-divider" />
                    <div className="player-profile-badges">
                      {detail.seasonImage && (
                        <img src={detail.seasonImage} alt="" />
                      )}
                      <span
                        className={`en-level-${Math.max(0, Math.min(13, detail.grade))}`}
                      >
                        +{detail.grade}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="player-profile-positions">
                  {detail.positions.length ? (
                    detail.positions.map((item) => (
                      <span key={item.position}>
                        <small>{item.position}</small>
                        <b>{item.value}</b>
                      </span>
                    ))
                  ) : (
                    <p>포지션 정보가 없습니다.</p>
                  )}
                </div>
                <dl className="player-profile-basics">
                  <div>
                    <dt>국가</dt>
                    <dd>
                      {detail.nationImage && (
                        <img src={detail.nationImage} alt="" />
                      )}
                      {detail.nation || "정보 없음"}
                    </dd>
                  </div>
                  <div>
                    <dt>신체</dt>
                    <dd>
                      {[detail.height, detail.weight]
                        .filter(Boolean)
                        .join(" · ") || "정보 없음"}
                    </dd>
                  </div>
                  <div>
                    <dt>체형</dt>
                    <dd>{detail.bodyType || "정보 없음"}</dd>
                  </div>
                  <div>
                    <dt>주발</dt>
                    <dd>{renderFoot(detail.foot, detail.footStrong)}</dd>
                  </div>
                  <div>
                    <dt>개인기</dt>
                    <dd>{renderSkillMoves(detail.skillMoves)}</dd>
                  </div>
                  <div>
                    <dt>생년월일</dt>
                    <dd>{detail.birthDate || "정보 없음"}</dd>
                  </div>
                </dl>
                <div className="player-profile-traits">
                  <h4>특성</h4>
                  <div>
                    {detail.traits.length ? (
                      detail.traits.map((trait) => (
                        <button
                          type="button"
                          key={`${trait.name}-${trait.image}`}
                          aria-label={trait.name}
                          data-tooltip={trait.name}
                        >
                          {trait.image ? (
                            <img src={trait.image} alt="" />
                          ) : (
                            <span aria-hidden="true" />
                          )}
                        </button>
                      ))
                    ) : (
                      <p>제공된 특성이 없습니다.</p>
                    )}
                  </div>
                </div>
                <div className="player-profile-abilities">
                  <h4>세부 능력치</h4>
                  <div>
                    {detail.abilities.length ? (
                      detail.abilities.map((ability, index) => (
                        <span key={`${ability.name}-${index}`}>
                          <small>{ability.name}</small>
                          <b
                            className={
                              ability.value >= 40
                                ? `ability-over-${Math.min(150, Math.floor(ability.value / 10) * 10)}`
                                : undefined
                            }
                          >
                            {ability.value}
                          </b>
                        </span>
                      ))
                    ) : (
                      <p>제공된 능력치가 없습니다.</p>
                    )}
                  </div>
                </div>
                <div className="player-detail-supplement player-profile-supplement" style={supplementStyle}>
                  <section className="player-detail-career">
                    <header><h4>클럽 경력</h4></header>
                    {detail.career?.length ? (
                      <div className="player-detail-career-list">
                        <div className="player-detail-career-head"><span>연도</span><span>클럽</span><span>임대 여부</span></div>
                        {detail.career.map((item, index) => (
                          <div key={`${item.year}-${item.club}-${index}`}><span>{item.year}</span><b>{item.club}</b><span>{item.loan || "—"}</span></div>
                        ))}
                      </div>
                    ) : (
                      <p className="player-detail-data-empty">제공된 클럽 경력이 없습니다.</p>
                    )}
                  </section>
                  <PlayerMarketChart market={detail.market} marketRef={marketRef} />
                </div>
              </article>
            ) : (
              <div className="players-empty players-empty-initial">
                <p>검색 결과에서 시즌을 선택해 주세요.</p>
              </div>
            )}
          </section>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
