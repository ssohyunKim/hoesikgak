import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../js/config.js";
import * as auth from "../js/auth.js";
import { submitRating } from "../js/rating.js";

/* ── 브라우저 흉내 ─────────────────────────── */
function fakeStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), clear: () => m.clear() };
}
function at(search) {
  globalThis.location = { search, href: "https://www.hoesikgak.com/" + search, pathname: "/", hash: "" };
}
let replaced;
globalThis.history = { replaceState: (_s, _t, url) => { replaced = url; } };
globalThis.localStorage = fakeStorage();
globalThis.sessionStorage = fakeStorage();

const API = "https://api.test";
let calls;
function stubFetch(reply) {
  calls = [];
  globalThis.fetch = async (url, opt) => {
    calls.push({ url, body: JSON.parse(opt.body) });
    const r = typeof reply === "function" ? reply(calls.length) : reply;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
}
const SESSION = { ok: true, uid: "k_" + "a".repeat(24), token: "t.sig", exp: Math.floor(Date.now() / 1000) + 600 };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  CONFIG.API_BASE = API; CONFIG.REQUIRE_LOGIN = true;
  at(""); replaced = undefined;
});

/* ── 설정 스위치 ───────────────────────────── */
test("API_BASE 가 비어 있으면 로그인을 걸지 않는다", () => {
  CONFIG.API_BASE = "";
  assert.equal(auth.enabled(), false);
  assert.equal(auth.required(), false, "배포 전에도 사이트가 멈추면 안 된다");
  CONFIG.API_BASE = API;
  assert.equal(auth.required(), true);
  CONFIG.REQUIRE_LOGIN = false;
  assert.equal(auth.required(), false);
});

/* ── 세션 ─────────────────────────────────── */
test("만료된 세션은 없는 것으로 치고 지운다", () => {
  localStorage.setItem("hoesik.session", JSON.stringify({ ...SESSION, exp: Math.floor(Date.now() / 1000) - 1 }));
  assert.equal(auth.session(), null);
  assert.equal(auth.loggedIn(), false);
  assert.equal(localStorage.getItem("hoesik.session"), null, "만료된 건 지워져야 한다");

  localStorage.setItem("hoesik.session", JSON.stringify(SESSION));
  assert.equal(auth.loggedIn(), true);
  assert.equal(auth.uid(), SESSION.uid);
  auth.logout();
  assert.equal(auth.loggedIn(), false);
});

/* ── 돌아왔을 때 ───────────────────────────── */
test("로그인 시도가 아니면 아무것도 안 한다", async () => {
  assert.equal(await auth.finish(), null);
  assert.equal(replaced, undefined, "주소를 건드리면 안 된다");
});

test("코드를 세션으로 바꾸고 주소창을 치운다", async () => {
  sessionStorage.setItem("hoesik.authState", "s1");
  at("?code=ABC&state=s1");
  stubFetch({ status: 200, body: SESSION });

  const r = await auth.finish();
  assert.deepEqual(r, { ok: true });
  assert.equal(calls[0].url, API + "/auth/kakao");
  assert.deepEqual(calls[0].body, { code: "ABC", redirectUri: CONFIG.SITE_URL },
    "redirectUri 는 Worker 의 REDIRECT_URIS 와 같아야 통과한다");
  assert.equal(auth.uid(), SESSION.uid);
  assert.equal(replaced, "/", "code·state 가 주소에 남으면 새로고침 때 다시 쓰인다");
  assert.equal(sessionStorage.getItem("hoesik.authState"), null, "state 는 한 번 쓰고 버린다");
});

test("state 가 다르면 토큰을 받지 않는다", async () => {
  sessionStorage.setItem("hoesik.authState", "s1");
  at("?code=ABC&state=다른값");
  stubFetch({ status: 200, body: SESSION });

  const r = await auth.finish();
  assert.deepEqual(r, { ok: false, error: "state" });
  assert.equal(calls.length, 0, "서버를 부르기 전에 막아야 한다");
  assert.equal(auth.loggedIn(), false);
});

test("사용자가 취소하면 조용히 돌려보낸다", async () => {
  at("?error=access_denied&error_description=x");
  const r = await auth.finish();
  assert.deepEqual(r, { ok: false, error: "denied" });
  assert.equal(auth.reason("denied"), "로그인을 취소했어요.");
  assert.equal(replaced, "/");
});

test("Worker 가 거절하면 로그인 상태가 되지 않는다", async () => {
  at("?code=ABC");
  stubFetch({ status: 401, body: { ok: false, error: "kakao_token" } });
  const r = await auth.finish();
  assert.deepEqual(r, { ok: false, error: "kakao_token" });
  assert.equal(auth.loggedIn(), false);
});

/* ── 평가 보내기 ───────────────────────────── */
test("401 이면 세션을 버린다", async () => {
  localStorage.setItem("hoesik.session", JSON.stringify(SESSION));
  stubFetch({ status: 401, body: { ok: false, error: "login" } });
  const r = await auth.postRate({ kakaoId: "1" });
  assert.deepEqual(r, { ok: false, error: "login" });
  assert.equal(auth.loggedIn(), false, "만료된 세션을 들고 있으면 계속 실패한다");
});

test("로그인 모드에서는 Worker 가 아는 이름으로 보낸다", async () => {
  localStorage.setItem("hoesik.session", JSON.stringify(SESSION));
  stubFetch({ status: 200, body: { ok: true } });

  const place = { kakaoId: "123", name: "목련갈비", cat: "고기", kcat: "음식점 > 한식",
    addr: "서울 중구 을지로 1", lat: 37.5, lng: 127.0 };
  await submitRating(place, { score: 4, text: "좋아요", budget: "40000", room: "있음" }, "보라매");

  assert.equal(calls[0].url, API + "/rate");
  const b = calls[0].body;
  assert.equal(b.token, SESSION.token);
  assert.equal(b.kakaoId, "123");
  assert.equal(b.name, "목련갈비");
  assert.equal(b.score, 4);
  assert.equal(b.budget, "40000");
  assert.equal(b.base, "보라매");
  assert.ok(b.reqId.startsWith(SESSION.uid), "요청ID 는 작성자로 시작한다");
  assert.equal(b["매장명"], undefined, "한글 이름은 Apps Script 가 모른다");
  assert.equal(b.author, undefined, "작성자는 Worker 가 세션에서 꺼내 붙인다");
});

test("보내기에 실패하면 예외가 난다 — 화면이 성공으로 바뀌면 안 된다", async () => {
  localStorage.setItem("hoesik.session", JSON.stringify(SESSION));
  stubFetch({ status: 200, body: { ok: false, error: "too_many" } });
  await assert.rejects(
    () => submitRating({ kakaoId: "1", name: "a", cat: "b" }, { score: 5 }, ""),
    /too_many/);
});
