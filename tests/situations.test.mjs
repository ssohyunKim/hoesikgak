import { test } from "node:test";
import assert from "node:assert/strict";
import { SITUATIONS, BUDGETS, situationOf, presetCond, score, bayes } from "../js/situations.js";

const P = o => ({ rated: true, score: 4, count: 3, recNo: 0, budget: 40000, fit: null, room: null,
  parking: null, noise: "", cat: "한식", verified: false, dist: 0, ...o });
const cond = o => ({ s: "any", n: null, b: "any", w: [], x: [], ...o });

test("상황과 예산 목록", () => {
  assert.equal(SITUATIONS.length, 10);
  assert.deepEqual(SITUATIONS.map(s => s.key),
    ["quick", "newbie-lunch", "vip-lunch", "cheap-lunch", "team", "vip", "small", "farewell", "cheap", "any"]);
  assert.equal(SITUATIONS.filter(s => s.time === "lunch").length, 4);
  assert.equal(SITUATIONS.filter(s => s.time === "dinner").length, 5);
  assert.deepEqual(BUDGETS.map(b => b.key), ["any", "u15", "u30", "3050", "o30", "o50"]);
  assert.equal(situationOf("없는키").key, "any");
});

test("presetCond", () => {
  assert.deepEqual(presetCond("team", { at: "보라매" }), { s: "team", n: 8, b: "3050", at: "보라매", w: [], x: [] });
  const v = presetCond("vip");
  assert.equal(v.b, "o50");
  assert.ok(v.w.includes("room") && v.w.includes("quiet"));
  assert.equal(presetCond("any").n, null);
});

test("별점: 평가 수를 감안한다", () => {
  assert.ok(bayes(P({ score: 4.5, count: 5 })) > bayes(P({ score: 5, count: 1 })));
  const s = situationOf("any");
  assert.ok(score(P({ score: 4.5, count: 5 }), cond(), s) > score(P({ score: 5, count: 1 }), cond(), s));
});

test("예산 밖이면 크게 깎인다", () => {
  const s = situationOf("any"), c = cond({ b: "3050" });
  assert.ok(score(P({ budget: 40000 }), c, s) - score(P({ budget: 80000 }), c, s) >= 20);
  assert.ok(score(P({ budget: 0 }), c, s) > score(P({ budget: 80000 }), c, s));
});

test("있으면 좋은 조건: 있음 > 모름 > 없음", () => {
  const s = situationOf("any"), c = cond({ w: ["room"] });
  const yes = score(P({ room: true }), c, s), unk = score(P({ room: null }), c, s), no = score(P({ room: false }), c, s);
  assert.ok(yes > unk && unk > no);
  const q = cond({ w: ["quiet"] });
  assert.ok(score(P({ noise: "조용" }), q, s) > score(P({ noise: "시끄러움" }), q, s));
});

test("인원 적합", () => {
  const s = situationOf("any"), c = cond({ n: 8 });
  assert.ok(score(P({ fit: { min: 6, max: 10 } }), c, s) > score(P({ fit: { min: 2, max: 4 } }), c, s));
  assert.ok(score(P({ fit: { min: 6, max: 10 } }), c, s) > score(P({ fit: null }), c, s));
});

test("상황 업종 가중", () => {
  const s = situationOf("team"), c = cond({ s: "team" });
  assert.equal(score(P({ cat: "고기" }), c, s) - score(P({ cat: "일식" }), c, s), 8);
});

test("빨리 먹기는 거리를 3배로 본다", () => {
  const q = situationOf("quick"), a = situationOf("any");
  const dq = score(P({ dist: 0 }), cond(), q) - score(P({ dist: 300 }), cond(), q);
  const da = score(P({ dist: 0 }), cond(), a) - score(P({ dist: 300 }), cond(), a);
  assert.ok(Math.abs(dq - 3 * da) < 1e-9, `${dq} vs ${da}`);
});

test("인증 +3, 비추 표 -5", () => {
  const s = situationOf("any");
  assert.equal(score(P({ verified: true }), cond(), s) - score(P(), cond(), s), 3);
  assert.equal(score(P(), cond(), s) - score(P({ recNo: 1 }), cond(), s), 5);
});
