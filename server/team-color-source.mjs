const sourceUrl = "https://fconline.nexon.com/datacenter/teamcolor?strTeamColorCategory=&strTeamColorType=%2Cclub%2Cnation%2Cspecial%2C&strCategory=&strTeamColorName=";
const cacheDurationMs = 6 * 60 * 60 * 1000;
let cachedNames = [];
let cacheExpiresAt = 0;

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseOfficialTeamColorNames(html) {
  const names = [];
  const seen = new Set();
  const pattern = /<div\s+class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(pattern)) {
    const name = decodeHtml(match[1]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export async function fetchOfficialTeamColorNames() {
  if (cachedNames.length && Date.now() < cacheExpiresAt) return cachedNames;
  try {
    const response = await fetch(sourceUrl, {
      headers: { "user-agent": "FC-SUPPORT/1.0 (+https://fc-support.kr)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const names = parseOfficialTeamColorNames(await response.text());
    if (!names.length) return [];
    cachedNames = names;
    cacheExpiresAt = Date.now() + cacheDurationMs;
    return cachedNames;
  } catch {
    return [];
  }
}
