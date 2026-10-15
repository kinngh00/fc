import { requireApiKeys } from "./config.mjs";
import { divisionMetadataPath, nexonJson, nicknamePath, userBasicPath, userMaxDivisionPath } from "./nexon-api.mjs";

const PROFILE_ROOT = "https://fconline.nexon.com";

function apiKeyFor(nickname, keys) {
  const index = [...nickname].reduce((sum, character) => sum + character.codePointAt(0), 0) % keys.length;
  return keys[index];
}

async function fetchWithRetry(url, options, fetchImpl) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok || (options.redirect === "manual" && response.status >= 300 && response.status < 400)) {
        return response;
      }
      throw new Error(`FC Online profile request returned ${response.status}.`);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function resolveProfileId(nickname, fetchImpl) {
  const lookupUrl = `${PROFILE_ROOT}/profile/common/PopProfile?strCharacterName=${encodeURIComponent(nickname)}`;
  const response = await fetchWithRetry(lookupUrl, {
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9",
      "user-agent": "FC-SUPPORT/1.0",
    },
  }, fetchImpl);
  const location = response.headers.get("location") || "";
  const match = location.match(/^\/profile\/squad\/popup\/(\d+)$/i);
  return match?.[1] || null;
}

export async function verifyGameNickname(nickname, { fetchImpl = fetch } = {}) {
  const normalized = String(nickname || "").trim();
  if (!normalized) return { exists: true };
  const lookupUrl = `${PROFILE_ROOT}/profile/common/PopProfile?strCharacterName=${encodeURIComponent(normalized)}`;
  const response = await fetchWithRetry(lookupUrl, {
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml", "accept-language": "ko-KR,ko;q=0.9", "user-agent": "FC-SUPPORT/1.0" },
  }, fetchImpl);
  const html = await response.text();
  return { exists: !html.includes("구단주 정보가 존재하지 않습니다.") };
}

async function fetchCurrentSquad(nexonSn, fetchImpl) {
  const profileUrl = `${PROFILE_ROOT}/profile/squad/popup/${encodeURIComponent(nexonSn)}`;
  const profileResponse = await fetchWithRetry(profileUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9",
      referer: `${PROFILE_ROOT}/datacenter/rank?rt=manager`,
      "user-agent": "FC-SUPPORT/1.0",
    },
  }, fetchImpl);
  const profileHtml = await profileResponse.text();
  const identifiers = profileHtml.match(/SquadProfile\.SetSquadInfo\("(\d+)",\s*"(\d+)",\s*"[^"]+",\s*"([^"]+)"\)/i);
  if (!identifiers) return null;

  const parameters = new URLSearchParams({
    strTeamType: identifiers[1],
    n1Type: identifiers[2],
    n8NexonSN: nexonSn,
    strCharacterID: identifiers[3],
  });
  const squadResponse = await fetchWithRetry(`${PROFILE_ROOT}/datacenter/SquadGetUserInfo?${parameters}`, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "ko-KR,ko;q=0.9",
      referer: profileUrl,
      "user-agent": "FC-SUPPORT/1.0",
      "x-requested-with": "XMLHttpRequest",
    },
  }, fetchImpl);
  return await squadResponse.json();
}

async function fetchCurrentManagerRecord(nexonSn, fetchImpl) {
  const response = await fetchWithRetry(`${PROFILE_ROOT}/Profile/Stat/TeamInfo/${encodeURIComponent(nexonSn)}?n1Type=52&n4MinGameCnt=1&n4MaxGameCnt=30`, {
    headers: {
      accept: "text/html, */*; q=0.01",
      "accept-language": "ko-KR,ko;q=0.9",
      referer: `${PROFILE_ROOT}/profile/stat/popup/${encodeURIComponent(nexonSn)}`,
      "user-agent": "FC-SUPPORT/1.0",
      "x-requested-with": "XMLHttpRequest",
    },
  }, fetchImpl);
  const html = await response.text();
  const currentSeason = html.match(/season_grade_info__current[\s\S]*?grade_desc[^>]*>\s*<strong>\s*(\d+)승\s*<\/strong>\s*(\d+)무\s*(\d+)패\s*\(([\d.]+)%\)/i);
  if (!currentSeason) return null;
  return {
    wins: Number(currentSeason[1]),
    draws: Number(currentSeason[2]),
    losses: Number(currentSeason[3]),
    winRate: Number(currentSeason[4]),
  };
}

export async function fetchLiveUser(nickname, {
  fetchImpl = fetch,
  nexonJsonImpl = nexonJson,
  apiKeys = requireApiKeys(),
} = {}) {
  const apiKey = apiKeyFor(nickname, apiKeys);
  const identity = await nexonJsonImpl(nicknamePath(nickname), apiKey);
  if (!identity?.ouid) return null;

  const [basic, maxDivisions, divisions, nexonSn] = await Promise.all([
    nexonJsonImpl(userBasicPath(identity.ouid), apiKey),
    nexonJsonImpl(userMaxDivisionPath(identity.ouid), apiKey).catch(() => null),
    nexonJsonImpl(divisionMetadataPath(), apiKey).catch(() => []),
    resolveProfileId(nickname, fetchImpl),
  ]);
  const maxDivisionItems = Array.isArray(maxDivisions) ? maxDivisions : maxDivisions ? [maxDivisions] : [];
  const maxDivision = maxDivisionItems.find((item) => Number(item?.matchType) === 52) || maxDivisionItems[0] || null;
  const divisionMeta = Array.isArray(divisions)
    ? divisions.find((item) => Number(item?.divisionId) === Number(maxDivision?.division))
    : null;
  const divisionImageIndex = Array.isArray(divisions)
    ? divisions.findIndex((item) => Number(item?.divisionId) === Number(maxDivision?.division))
    : -1;
  const [squad, managerRecord] = nexonSn ? await Promise.all([
    fetchCurrentSquad(nexonSn, fetchImpl),
    fetchCurrentManagerRecord(nexonSn, fetchImpl).catch(() => null),
  ]) : [null, null];

  return {
    source: "nexon-live",
    nickname: String(basic?.nickname || nickname),
    ouid: String(identity.ouid),
    level: Number.isFinite(Number(basic?.level)) ? Number(basic.level) : null,
    nexonSn,
    squad,
    managerRecord,
    maxDivision: maxDivision ? {
      matchType: Number(maxDivision.matchType),
      division: Number(maxDivision.division),
      divisionName: String(divisionMeta?.divisionName || maxDivision.division),
      divisionImage: divisionImageIndex >= 0
        ? `https://ssl.nexon.com/s2/game/fo4/obt/rank/large/update_2026/ico_rank${divisionImageIndex}.png`
        : null,
      achievementDate: String(maxDivision.achievementDate || ""),
    } : null,
  };
}
