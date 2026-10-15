const API_ROOT = "https://open.api.nexon.com";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const value = response.headers.get("retry-after");
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(value || "");
  if (Number.isFinite(date) && date > Date.now()) return date - Date.now();
  return 750 * 2 ** attempt;
}

export class NexonApiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "NexonApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function nexonJson(path, apiKey) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: { accept: "application/json", "x-nxopen-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return await response.json();

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      const error = new NexonApiError(
        `NEXON API ${response.status}: ${body.slice(0, 300)}`,
        { status: response.status, retryable },
      );
      if (!retryable) throw error;
      lastError = error;
      if (attempt < 5) await wait(retryDelay(response, attempt));
    } catch (error) {
      if (error instanceof NexonApiError && !error.retryable) throw error;
      lastError = error;
      if (attempt < 5) await wait(750 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function mapWithKeyPool(items, keys, concurrencyPerKey, mapper, { onProgress } = {}) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  async function worker(apiKey) {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await mapper(items[index], apiKey, index) };
      } catch (error) {
        results[index] = {
          ok: false,
          error: {
            message: String(error?.message || error),
            status: Number(error?.status || 0),
          },
        };
      }
      completed += 1;
      onProgress?.({ completed, total: items.length });
    }
  }

  const workers = keys.flatMap((key) =>
    Array.from({ length: concurrencyPerKey }, () => worker(key)),
  );
  await Promise.all(workers);
  return results;
}

export function nicknamePath(nickname) {
  return `/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`;
}

export function userBasicPath(ouid) {
  return `/fconline/v1/user/basic?ouid=${encodeURIComponent(ouid)}`;
}

export function userMaxDivisionPath(ouid) {
  return `/fconline/v1/user/maxdivision?ouid=${encodeURIComponent(ouid)}`;
}

export function divisionMetadataPath() {
  return "/static/fconline/meta/division.json";
}

export function latestManagerMatchPath(ouid, offset = 0, limit = 1) {
  return `/fconline/v1/user/match?ouid=${encodeURIComponent(ouid)}&matchtype=52&offset=${offset}&limit=${limit}`;
}

export function matchDetailPath(matchId) {
  return `/fconline/v1/match-detail?matchid=${encodeURIComponent(matchId)}`;
}
