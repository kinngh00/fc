import assert from "node:assert/strict";
import test from "node:test";

import { fetchLiveUser } from "../server/live-user-service.mjs";

test("fetchLiveUser returns the manager-mode max division with its official name", async () => {
  const paths = [];
  const result = await fetchLiveUser("테스트구단주", {
    apiKeys: ["test-key"],
    fetchImpl: async () => new Response(null, { status: 302 }),
    nexonJsonImpl: async (path) => {
      paths.push(path);
      if (path.startsWith("/fconline/v1/id?")) return { ouid: "ouid-1" };
      if (path.startsWith("/fconline/v1/user/basic?")) return { nickname: "테스트구단주", level: 632 };
      if (path.startsWith("/fconline/v1/user/maxdivision?")) return [
        { matchType: 50, division: 900, achievementDate: "2026-09-01T00:00:00" },
        { matchType: 52, division: 1100, achievementDate: "2026-10-01T00:00:00" },
      ];
      if (path === "/static/fconline/meta/division.json") return [
        { divisionId: 800, divisionName: "슈퍼 챔피언스" },
        { divisionId: 900, divisionName: "챔피언스" },
        { divisionId: 1000, divisionName: "슈퍼 챌린지" },
        { divisionId: 1100, divisionName: "챌린저1" },
      ];
      throw new Error(`Unexpected path: ${path}`);
    },
  });

  assert.equal(result.level, 632);
  assert.deepEqual(result.maxDivision, {
    matchType: 52,
    division: 1100,
    divisionName: "챌린저1",
    divisionImage: "https://ssl.nexon.com/s2/game/fo4/obt/rank/large/update_2026/ico_rank3.png",
    achievementDate: "2026-10-01T00:00:00",
  });
  assert.ok(paths.some((path) => path.startsWith("/fconline/v1/user/maxdivision?ouid=ouid-1")));
});
