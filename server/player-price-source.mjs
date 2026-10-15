const PLAYER_PRICE_ENDPOINT = "https://fconline.nexon.com/datacenter/PlayerPriceGraph";

export const PRICE_SOURCE_KIND = "player-price-graph-last-record";

export function playerPriceRequestBody(spid, grade) {
  return new URLSearchParams({
    spid: String(spid),
    n1Strong: String(grade),
  }).toString();
}
function quotedValues(block) {
  return [...String(block || "").matchAll(/["']([^"']*)["']/g)].map((match) => match[1].trim());
}

export function parsePlayerPriceGraph(html) {
  const source = String(html || "");
  const dates = quotedValues(source.match(/["']time["']\s*:\s*\[([\s\S]*?)\]/i)?.[1]);
  const values = quotedValues(source.match(/["']value["']\s*:\s*\[([\s\S]*?)\]/i)?.[1]);
  const currentPrice = (source.match(/<strong\b[^>]*\balt=["']([\d,]+)["']/i)?.[1] || "").replace(/,/g, "") || null;
  const history = dates
    .map((date, index) => ({ date, price: String(values[index] || "").replace(/[^0-9]/g, "") }))
    .filter((item) => item.date && item.price);
  return { currentPrice, history };
}

export function parseLastRecordedPrice(html) {
  return parsePlayerPriceGraph(html).history.at(-1)?.price || null;
}

export async function fetchPlayerPriceGraph(spid, grade) {
  const body = playerPriceRequestBody(spid, grade);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(PLAYER_PRICE_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "*/*",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          referer: `https://fconline.nexon.com/DataCenter/PlayerInfo?spid=${encodeURIComponent(spid)}&n1Strong=${encodeURIComponent(grade)}`,
          "user-agent": "Mozilla/5.0 FC-SUPPORT player market",
          "x-requested-with": "XMLHttpRequest",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`PlayerPriceGraph returned ${response.status}.`);
      return parsePlayerPriceGraph(await response.text());
    } catch {
      if (attempt === 3) return { currentPrice: null, history: [] };
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  return { currentPrice: null, history: [] };
}

export async function fetchPlayerLastRecordedPrice(spid, grade) {
  const graph = await fetchPlayerPriceGraph(spid, grade);
  return graph.history.at(-1)?.price || null;
}
