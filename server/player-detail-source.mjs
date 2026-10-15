const PLAYER_ABILITY_ENDPOINT = "https://fconline.nexon.com/datacenter/PlayerAbility";
const PLAYER_INFO_ENDPOINT = "https://fconline.nexon.com/DataCenter/PlayerInfo";

function decodeHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classText(html, className) {
  const name = escapePattern(className);
  const match = String(html).match(new RegExp(`<([a-z0-9]+)[^>]+class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"));
  return decodeHtml(match?.[2] || "");
}

function classBlock(html, className) {
  const name = escapePattern(className);
  return String(html).match(new RegExp(`<([a-z0-9]+)[^>]+class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"))?.[2] || "";
}

export function highResolutionNationImage(url) {
  return String(url || "").replace(
    /\/countries\/smallflags\/(\d+)\.png(?:\?.*)?$/i,
    "/countries/largeflags/f_$1.png",
  ) || null;
}

function parseTeamColors(html) {
  const source = String(html || "");
  const categories = [
    { className: "en", label: "강화 팀컬러" },
    { className: "tdefault", label: "소속 팀컬러" },
    { className: "tspecial", label: "관계 팀컬러" },
  ].map((category) => ({
    ...category,
    start: source.search(new RegExp(`<div[^>]+class=["'][^"']*\\b${category.className}\\b[^"']*["'][^>]*>`, "i")),
  })).filter((category) => category.start >= 0);

  return categories.map((category, index) => {
    const nextStart = categories.slice(index + 1).map((item) => item.start).find((start) => start > category.start) ?? source.length;
    const section = source.slice(category.start, nextStart);
    const items = [...section.matchAll(/<a[^>]+class=["'][^"']*\bselector_item\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => decodeHtml(match[1]))
      .filter((item) => item && item !== category.label && !/^[\d\s.-]+$/.test(item));
    return { label: category.label, items: [...new Set(items)] };
  }).filter((category) => category.items.length);
}

export function parsePlayerCareer(html) {
  const source = String(html || "");
  const start = source.search(/class=["'][^"']*\bdata_detail_club\b[^"']*["']/i);
  if (start < 0) return [];
  const section = source.slice(start, start + 60_000);
  return [...section.matchAll(/<li[^>]*>[\s\S]*?<div[^>]+class=["'][^"']*\byear\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]+class=["'][^"']*\bclub\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]+class=["'][^"']*\brent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/li>/gi)]
    .map((match) => ({ year: decodeHtml(match[1]), club: decodeHtml(match[2]), loan: decodeHtml(match[3]) || null }))
    .filter((item) => item.year && item.club);
}

export async function fetchPlayerCareer(spid, grade) {
  const url = `${PLAYER_INFO_ENDPOINT}?spid=${encodeURIComponent(spid)}&n1Strong=${encodeURIComponent(grade)}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 FC-SUPPORT player career" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`PlayerInfo returned ${response.status}.`);
      return parsePlayerCareer(await response.text());
    } catch {
      if (attempt === 3) return [];
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  return [];
}

export function playerAbilityRequestBody(spid, grade, adaptation = 0, teamColorLevel = 0) {
  return new URLSearchParams({
    spid: String(spid),
    n1Strong: String(grade),
    n1Grow: String(adaptation),
    n4TeamColorId: "0",
    n4TeamColorLv: String(teamColorLevel),
    n4TeamColorId_Enhance: "0",
    n4TeamColorLv_Enhance: "0",
    n4TeamColorId_Feature: "0",
    n1Change: "0",
    strPlayerImg: "",
  }).toString();
}

export function parsePlayerAbility(html, { spid, grade } = {}) {
  const source = String(html || "");
  const name = classText(source, "name");
  if (!name) return null;
  const nationBlock = source.match(/<div[^>]+class=["'][^"']*\betc\b[^"']*\bnation\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";

  const positions = [...source.matchAll(/<span[^>]+class=["']position\s+[^"']*["'][^>]*>[\s\S]*?<span[^>]+class=["']txt["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]+class=["'][^"']*skillData_[^"']*\svalue["'][^>]*>\s*(\d+)/gi)]
    .map((match) => ({ position: decodeHtml(match[1]), value: Number(match[2]) }))
    .filter((item) => item.position && Number.isFinite(item.value));

  const traits = [...source.matchAll(/<span[^>]*>\s*<img[^>]+src=["']([^"']+)["'][^>]*>\s*<span[^>]+class=["']desc["'][^>]*>([\s\S]*?)<\/span>\s*<\/span>/gi)]
    .map((match) => ({ image: decodeHtml(match[1]), name: decodeHtml(match[2]) }))
    .filter((item) => item.name && item.image);

  const abilities = [...source.matchAll(/<li[^>]+class=["'][^"']*\bab\b[^"']*["'][^>]*>[\s\S]*?<div[^>]+class=["']txt["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]+class=["'][^"']*\bvalue\b[^"']*["'][^>]*>\s*(-?\d+)/gi)]
    .map((match) => ({ name: decodeHtml(match[1]), value: Number(match[2]) }))
    .filter((item) => item.name && Number.isFinite(item.value));

  const actionImage = source.match(/name=["']hidPlayerCustImg["'][^>]+value=["']([^"']+)["']/i)?.[1] || null;
  const seasonImage = source.match(/externalAssets\/new\/season\/([^"'?]+\.png)/i)?.[0] || null;
  const payMatch = source.match(/<div[^>]+class=["'][^"']*\bpay\b[^"']*["'][^>]*>[\s\S]*?<span[^>]*>\s*(\d+)\s*<\/span>/i);
  const footBlock = classBlock(source, "foot");
  const foot = decodeHtml(footBlock);
  const footStrong = decodeHtml(footBlock.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || "");
  const teamColors = parseTeamColors(source);

  return {
    spid: String(spid || source.match(/skillData_(\d+)/i)?.[1] || ""),
    grade: Number(grade ?? source.match(/class=["']ability\s+en_level(\d+)/i)?.[1] ?? 0),
    name,
    season: decodeHtml(source.match(/<span[^>]+class=["'][^"']*\betc\b[^"']*\bseason\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "") || null,
    seasonImage: seasonImage ? `https://ssl.nexon.com/s2/game/fc/online/obt/${seasonImage}` : null,
    image: actionImage,
    ovr: Number(source.match(/<div[^>]+class=["'][^"']*\bovr\s+value\b[^"']*["'][^>]*>\s*(\d+)/i)?.[1] || 0) || null,
    pay: Number(payMatch?.[1] || 0) || null,
    positions,
    birthDate: classText(source, "birth") || null,
    height: classText(source, "height") || null,
    weight: classText(source, "weight") || null,
    bodyType: classText(source, "physical") || null,
    skillMoves: decodeHtml(source.match(/<span[^>]+class=["'][^"']*\betc\b[^"']*\bskill\b[^"']*["'][^>]*>([\s\S]*?<\/span>\s*[★☆]*)\s*<\/span>/i)?.[1] || "") || null,
    foot: foot || null,
    footStrong: footStrong || null,
    nation: classText(nationBlock, "txt") || null,
    nationImage: highResolutionNationImage(nationBlock.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]),
    teamColors,
    traits,
    abilities,
  };
}

async function requestPlayerAbility(spid, grade, adaptation = 0, teamColorLevel = 0) {
  const body = playerAbilityRequestBody(spid, grade, adaptation, teamColorLevel);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(PLAYER_ABILITY_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "text/html, */*; q=0.01",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          referer: `https://fconline.nexon.com/DataCenter/PlayerInfo?spid=${encodeURIComponent(spid)}&n1Strong=${encodeURIComponent(grade)}`,
          "user-agent": "Mozilla/5.0 FC-SUPPORT player detail",
          "x-requested-with": "XMLHttpRequest",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`PlayerAbility returned ${response.status}.`);
      return parsePlayerAbility(await response.text(), { spid, grade });
    } catch {
      if (attempt === 3) return null;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  return null;
}

export async function fetchPlayerAbilityAtAdaptation(spid, grade, adaptation = 0, teamColorLevel = 0) {
  return requestPlayerAbility(spid, grade, adaptation, teamColorLevel);
}

export async function fetchPlayerAbility(spid, grade, adaptation = 0, teamColorLevel = 0) {
  const player = await requestPlayerAbility(spid, grade, adaptation, teamColorLevel);
  if (!player || Number(grade) === 1) return player;

  const basePlayer = await requestPlayerAbility(spid, 1, adaptation, teamColorLevel);
  return basePlayer?.skillMoves ? { ...player, skillMoves: basePlayer.skillMoves } : player;
}
