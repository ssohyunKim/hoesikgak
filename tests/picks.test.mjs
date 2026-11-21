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

/* 기준 위치를 사용자가 직접 등록하게 되면서 고정 사옥이 없어졌다.
   거리를 못 재는 곳은 "가까운지" 판단할 방법이 없으니 후보에서 뺀다 */
test("좌표 없는 가게는 후보에 오르지 않는다", () => {
  const noxy = R({ lat: null, lng: null }), ok = R();
  const { list } = run([noxy, ok], []);
  assert.deepEqual(list.map(p => p.id), [ok.id]);
});

test("입력 객체를 바꾸지 않는다", () => {
  const r = R();
  run([r], []);
  assert.equal(r.dist, undefined);
});

/* ── 업종 좁히기 ───────────────────────────── */
test("업종 개수는 좁히기 전 전체를 센다 — 눌러서 0곳이 되면 안 된다", () => {
  const a = R({ cat: "고기" }), b = R({ cat: "고기" }), c2 = R({ cat: "이자카야" }), d = R({ cat: "한식" });
  const { cats, total, list } = run([a, b, c2, d], []);
  assert.equal(total, 4);
  assert.deepEqual(cats, [{ cat: "고기", n: 2 }, { cat: "이자카야", n: 1 }, { cat: "한식", n: 1 }]);
  assert.equal(list.length, 4, "고르기 전에는 전부 보인다");
  for (const { cat, n } of cats) {
    const picked = run([a, b, c2, d], [], cond({ c: cat }));
    assert.equal(picked.list.length, n, `${cat} 칩의 개수와 실제 목록이 같아야 한다`);
  }
});

test("업종을 고르면 목록과 룰렛이 같이 좁아진다", () => {
  const meat = [R({ cat: "고기" }), R({ cat: "고기" })], izak = R({ cat: "이자카야" });
  const { list, wheel, cat } = run([...meat, izak], [], cond({ c: "고기" }));
  assert.equal(cat, "고기");
  assert.deepEqual(list.map(p => p.cat), ["고기", "고기"]);
  assert.deepEqual(wheel.map(p => p.cat), ["고기", "고기"], "룰렛에 다른 업종이 섞이면 안 된다");
});

test("없는 업종을 주소로 넘기면 무시하고 전체를 보여준다", () => {
  const { list, cat } = run([R({ cat: "고기" })], [], cond({ c: "중식" }));
  assert.equal(cat, "", "빈 화면 대신 전체로 되돌린다");
  assert.equal(list.length, 1);
});

test("상황이 미는 업종이 칩 앞에 온다", () => {
  const places = [R({ cat: "한식" }), R({ cat: "한식" }), R({ cat: "한식" }), R({ cat: "곱창" })];
  const { cats } = run(places, [], cond({ s: "team" }));   // 팀 회식 → 고기·곱창
  assert.equal(cats[0].cat, "곱창", "개수가 적어도 상황에 맞는 업종이 먼저");
  assert.equal(cats[1].cat, "한식");
});

test("업종이 하나뿐이면 칩을 그릴 필요가 없다", () => {
  const { cats } = run([R({ cat: "고기" }), R({ cat: "고기" })], []);
  assert.equal(cats.length, 1);
});
