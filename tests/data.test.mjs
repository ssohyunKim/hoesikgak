import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, normHead, starScore, parseHead, roomOf, tri, catOf,
  aggregate, legacyPlaces, combine, mergeAll, mergePending, CLOSED_MARK, fromApi } from "../js/data.js";

const row = o => ({ "카카오ID": "100", "매장명": "삼겹리에", "업종": "고기", "카카오분류": "음식점 > 한식 > 육류,고기",
  "주소": "서울 관악구 x", "위도": "37.4995", "경도": "126.9210", "별점": "4", "작성자": "A", ...o });

test("parseCSV / normHead", () => {
  const rows = parseCSV('a,"b,c","d\n e"\n1,2,3\n');
  assert.deepEqual(rows, [["a", "b,c", "d\n e"], ["1", "2", "3"]]);
  assert.equal(normHead("3. 인당 예산 (숫자만 예: 30000)"), "인당예산");
  assert.equal(normHead("0. 사옥"), "사옥");
});

test("starScore", () => {
  assert.equal(starScore("⭐️⭐️⭐️⭐️"), 4);
  assert.equal(starScore("별점도 아깝다"), 0);
  assert.equal(starScore(""), null);
  assert.equal(starScore("4.5"), 4.5);
  assert.equal(starScore("0"), 0);
});

test("parseHead", () => {
  assert.deepEqual(parseHead("9~12명"), { min: 9, max: 12, label: "9~12명" });
  assert.deepEqual(parseHead("4명 이하"), { min: 2, max: 4, label: "4명 이하" });
  assert.deepEqual(parseHead("20명 이상"), { min: 20, max: 99, label: "20명 이상" });
  assert.equal(parseHead("잘 모르겠음"), null);
  assert.equal(parseHead(""), null);
});

test("roomOf / tri / catOf", () => {
  assert.equal(roomOf("있음"), true);
  assert.equal(roomOf("8인룸 2개"), true);
  assert.equal(roomOf("없음"), false);
  assert.equal(roomOf("잘 모르겠음"), null);
  assert.equal(tri("가능"), true);
  assert.equal(tri("불가"), false);
  assert.equal(tri(""), null);
  assert.equal(catOf("음식점 > 한식 > 육류,고기 > 곱창,막창"), "곱창");
  assert.equal(catOf("음식점 > 술집 > 일본식주점"), "이자카야");
  assert.equal(catOf("음식점 > 양식"), "양식");
});

test("aggregate: 작성자별 마지막 행만 센다", () => {
  const [p] = aggregate([row({ "별점": "3" }), row({ "별점": "5" }), row({ "작성자": "B", "별점": "4" })]);
  assert.equal(p.count, 2);
  assert.equal(p.score, 4.5);
  assert.equal(p.id, "k100");
  assert.equal(p.rated, true);
});

test("aggregate: 문 닫았어요 신고는 서로 다른 2명이면 숨긴다", () => {
  const closed = { "별점": "", "한줄평": CLOSED_MARK };
  assert.equal(aggregate([row({ "작성자": "A" }), row({ "작성자": "B", ...closed })]).length, 1);
  assert.equal(aggregate([row({ "작성자": "B", ...closed }), row({ "작성자": "B", ...closed })]).length, 1);
  assert.equal(aggregate([row({ "작성자": "B", ...closed }), row({ "작성자": "C", ...closed })]).length, 0);
  const [p] = aggregate([row({ "작성자": "A", "한줄평": "맛있음" }), row({ "작성자": "B", ...closed })]);
  assert.equal(p.closedReports, 1);
  assert.deepEqual(p.reviews.map(r => r.txt), ["맛있음"]);   // 신고 문구는 후기로 안 보인다
  assert.equal(p.count, 1);
});

test("aggregate: 예산 중앙값, 룸 최빈값, 비추", () => {
  const [p] = aggregate([
    row({ "작성자": "A", "인당예산": "25000", "룸": "있음" }),
    row({ "작성자": "B", "인당예산": "40000", "룸": "있음" }),
    row({ "작성자": "C", "인당예산": "70000", "룸": "없음" })]);
  assert.equal(p.budget, 40000);
  assert.equal(p.room, true);

  const [q] = aggregate([row({ "작성자": "A", "별점": "1" }), row({ "작성자": "B", "별점": "1" }),
    row({ "작성자": "C", "별점": "5" })]);
  assert.equal(q.recNo, 2);
  assert.equal(q.rec, true);
  assert.ok(Math.abs(q.score - 7 / 3) < 1e-9);

  const [r] = aggregate([row({ "별점": "1", "한줄평": "양이 줄었다" })]);
  assert.equal(r.rec, false);
  assert.equal(r.reviews[0].bad, true);
});

test("aggregate: 이스케이프와 잘못된 ID", () => {
  const list = aggregate([row({ "매장명": "<b>집</b>" }), row({ "카카오ID": "abc" })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "&lt;b&gt;집&lt;/b&gt;");
});

test("legacyPlaces: 같은 매장명+사옥은 합치고 별점 평균", () => {
  const list = legacyPlaces([
    { "매장명": "친구네정육식당", "업종": "고기", "평점": "⭐️⭐️⭐️⭐️", "사옥": "보라매", "적정인원": "13~20명", "룸": "없음" },
    { "매장명": "친구네 정육식당", "업종": "고기", "평점": "⭐️⭐️", "사옥": "보라매", "인당예산": "50000" },
    { "매장명": "친구네정육식당", "업종": "고기", "평점": "5", "사옥": "마포" }]);
  assert.equal(list.length, 2);
  const b = list.find(p => p.office === "보라매");
  assert.equal(b.score, 3);
  assert.equal(b.count, 2);
  assert.equal(b.budget, 50000);
  assert.equal(b.room, false);
  assert.equal(b.lat, null);
  assert.match(b.id, /^L/);
});

test("combine / mergeAll", () => {
  const [legacy] = legacyPlaces([{ "매장명": "삼겹리에", "업종": "고기", "평점": "2", "사옥": "보라매", "인당예산": "42000" }]);
  legacy.kakaoId = "100";
  const [agg] = aggregate([row({ "별점": "5" })]);
  const c = combine(legacy, agg);
  assert.equal(c.count, 2);
  assert.equal(c.score, 3.5);
  assert.equal(c.budget, 42000);
  assert.equal(c.id, "k100");
  assert.equal(c.lat, 37.4995);
  const all = mergeAll([legacy], [agg]);
  assert.equal(all.length, 1);
});

test("mergePending", () => {
  const now = Date.UTC(2026, 10, 20);
  const pending = [{ "요청ID": "r1", _t: now - 1000 }, { "요청ID": "r2", _t: now - 1000 }, { "요청ID": "r3", _t: now - 4 * 864e5 }];
  const { rows, keep } = mergePending([{ "요청ID": "r1" }], pending, now);
  assert.deepEqual(keep.map(r => r["요청ID"]), ["r2"]);
  assert.deepEqual(rows.map(r => r["요청ID"]), ["r1", "r2"]);
});

/* ── D1 → 화면 ─────────────────────────────── */
test("fromApi: 서버 컬럼을 시트 열 이름으로 바꾼다", () => {
  const r = fromApi({ kakaoId: 900001, name: "디원고기집", cat: "고기", kcat: "음식점 > 한식",
    addr: "서울 관악구 1", lat: 37.5, lng: 127, author: "k_x1", score: 4, budget: 40000,
    room: "있음", parking: "가능", noise: "보통", fit: "5~8명", text: "좋아요", closed: 0, reqId: "d1" });
  assert.equal(r["카카오ID"], "900001");          // 문자열이어야 aggregate 가 묶는다
  assert.equal(r["매장명"], "디원고기집");
  assert.equal(r["별점"], "4");
  assert.equal(r["한줄평"], "좋아요");
  assert.equal(r["요청ID"], "d1");
  /* 그대로 집계에 넣어도 돌아가야 한다 */
  const [p] = aggregate([r]);
  assert.equal(p.name, "디원고기집");
  assert.equal(p.score, 4);
  assert.equal(p.rated, true);
});

test("fromApi: 별점 없는 폐업 신고", () => {
  const r = fromApi({ kakaoId: 1, name: "닫은집", lat: 37.5, lng: 127, author: "k_a", score: null, closed: 1 });
  assert.equal(r["별점"], "", "빈 칸이어야 평균에서 빠진다");
  assert.equal(r["한줄평"], CLOSED_MARK);
  /* 0점(비추)으로 세면 안 된다 */
  const [p] = aggregate([r]);
  assert.equal(p.rated, false);
  assert.equal(p.closedReports, 1);
});

test("fromApi: 0점은 빈 칸과 다르다", () => {
  const r = fromApi({ kakaoId: 1, name: "별점아까운집", lat: 37.5, lng: 127, author: "k_a", score: 0, closed: 0 });
  assert.equal(r["별점"], "0");
  const [p] = aggregate([r]);
  assert.equal(p.rated, true);
  assert.equal(p.rec, false, "0점은 비추");
});
