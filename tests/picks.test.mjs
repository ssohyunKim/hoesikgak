import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPicks } from "../js/picks.js";
import { situationOf } from "../js/situations.js";

const CFG = { NEAR_RADIUS: 1500, ROULETTE_MIN: 3, MIN_GOOD: 6, MIN_PICKS: 8, WHEEL_MAX: 8 };
const BASE = { key: "보라매", lat: 37.4993, lng: 126.9203 };
const at = m => ({ lat: BASE.lat + m / 111000, lng: BASE.lng });   // 북쪽으로 m 미터
let seq = 0;
const R = o => ({ id: "k" + (++seq), kakaoId: String(seq), name: "평가" + seq, cat: "고기", rated: true, score: 4,
  count: 3, recNo: 0, rec: true, budget: 0, fit: null, room: null, parking: null, noise: "",
  office: "보라매", ...at(200), ...o });
const N = o => ({ ...R({ rated: false, score: 0, count: 0, isNew: true }), name: "주변" + seq, ...o });
const cond = o => ({ s: "any", n: null, b: "any", w: [], x: [], at: "보라매", ...o });
const run = (rated, nearby, c = cond(), s = "any") => buildPicks(rated, nearby, c, situationOf(c.s || s), CFG, BASE);

test("반경 밖·비추·뺀 곳은 빠진다", () => {
  const far = R({ ...at(2000) }), bad = R({ rec: false, score: 1 }), ex = R(), ok = R();
  const { list } = run([far, bad, ex, ok], [], cond({ x: [ex.kakaoId] }));
  assert.deepEqual(list.filter(p => !p.isNew).map(p => p.id), [ok.id]);
});

test("좋은 곳이 6곳 미만이면 🆕 로 8곳까지 채운다 (가까운 순)", () => {
  const good = [R(), R(), R()];
  const near = Array.from({ length: 10 }, (_, i) => N({ ...at(900 - i * 80) }));
  const { list } = run(good, near);
  const fresh = list.filter(p => p.isNew);
  assert.equal(list.length, 8);
  assert.equal(fresh.length, 5);
  assert.ok(fresh.every((p, i, a) => i === 0 || a[i - 1].dist <= p.dist));
});

test("좋은 곳이 6곳 이상이면 채우지 않는다", () => {
  const good = Array.from({ length: 7 }, () => R());
  const { list } = run(good, [N(), N()]);
  assert.equal(list.filter(p => p.isNew).length, 0);
});

test("상황 업종이 있으면 그 업종만 채운다", () => {
  const near = [N({ cat: "고기" }), N({ cat: "일식" }), N({ cat: "곱창" })];
  const { list } = run([], near, cond({ s: "team" }));
  assert.deepEqual(list.map(p => p.cat).sort(), ["고기", "곱창"]);
});

test("3점 미만은 목록 끝, 룰렛에는 없음", () => {
  const low = R({ score: 2.5 }), good = R({ score: 4.5 });
  const { list, wheel } = run([low, good], []);
  assert.equal(list[list.length - 1].id, low.id);
  assert.equal(list[list.length - 1].low, true);
  assert.ok(!wheel.some(p => p.id === low.id));
});

test("룰렛은 8칸 이하", () => {
  const { wheel } = run(Array.from({ length: 12 }, () => R()), []);
  assert.equal(wheel.length, 8);
});

test("이미 평가된 가게는 🆕 로 중복되지 않는다", () => {
  const r = R();
  const dup = N({ kakaoId: r.kakaoId, id: r.id });
  const { list } = run([r], [dup]);
  assert.equal(list.filter(p => p.kakaoId === r.kakaoId).length, 1);
  assert.equal(list.find(p => p.kakaoId === r.kakaoId).isNew, false);
});

test("비추 가게는 주변 검색에 나와도 🆕 로 되살아나지 않는다", () => {
  const bad = R({ rec: false, score: 1 });
  const { list } = run([bad], [N({ kakaoId: bad.kakaoId, id: bad.id })]);
  assert.equal(list.length, 0);
});

test("좌표 없는 옛 가게는 같은 사옥일 때만", () => {
  const here = R({ lat: null, lng: null, office: "보라매" }), there = R({ lat: null, lng: null, office: "마포" });
  const { list } = run([here, there], []);
  assert.deepEqual(list.map(p => p.id), [here.id]);
  assert.equal(list[0].dist, null);
});

test("입력 객체를 바꾸지 않는다", () => {
  const r = R();
  run([r], []);
  assert.equal(r.dist, undefined);
});
