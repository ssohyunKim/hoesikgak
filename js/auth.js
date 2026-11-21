/* ═══════════════════════════════════════════════════
   카카오 로그인

   흐름
     1. 로그인 버튼 → Kakao.Auth.authorize() 가 카카오로 보낸다
     2. 카카오가 주소에 ?code= 를 붙여 사이트로 돌려보낸다
     3. 그 코드를 Worker 에 넘기면 회식각 세션 토큰이 돌아온다

   2번 코드를 토큰으로 바꾸는 일은 브라우저에서 못 한다. REST 키와 시크릿이 필요하고
   카카오가 브라우저 요청을 CORS 로 막기 때문이다. 그래서 worker/ 가 필요하다.
   CONFIG.API_BASE 가 비어 있으면(=배포 전) 로그인을 끄고 익명으로 돈다.

   저장하는 것은 Worker 가 준 세션 토큰과 uid 뿐이다.
   uid 는 카카오 회원번호를 HMAC 으로 돌린 값이라 회원번호 자체는 여기에도 시트에도 남지 않는다.
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import * as store from "./store.js";
import { kakaoSdk } from "./share.js";

const KEY = "hoesik.session";
const STATE_KEY = "hoesik.authState";
const api = path => String(CONFIG.API_BASE || "").replace(/\/+$/, "") + path;

export const enabled = () => !!CONFIG.API_BASE;
export const required = () => !!(CONFIG.REQUIRE_LOGIN && enabled());

/* 만료된 세션은 없는 것으로 친다 */
export function session() {
  const s = store.get(KEY, null);
  if (!s || !s.token || !s.uid) return null;
  if (s.exp && s.exp <= Date.now() / 1000) { store.del(KEY); return null; }
  return s;
}
export const loggedIn = () => !!session();
export const uid = () => (session() || {}).uid || "";
export function logout() { store.del(KEY); }

/* 카카오로 보낸다. redirectUri 는 카카오 콘솔과 Worker 의 REDIRECT_URIS 에
   등록된 주소와 글자까지 같아야 한다 */
export async function login() {
  if (!enabled()) throw new Error("no_api");
  if (!(await kakaoSdk())) throw new Error("no_sdk");
  const state = rand();
  try { sessionStorage.setItem(STATE_KEY, state); } catch { /* 저장 불가 환경 */ }
  Kakao.Auth.authorize({ redirectUri: CONFIG.SITE_URL, state });
}

/* 돌아왔을 때 ?code= 를 세션으로 바꾼다. 처리 여부와 무관하게 주소창은 깨끗이 되돌린다.
   돌려주는 값: null(로그인 시도가 아님) | {ok:true} | {ok:false, error} */
export async function finish() {
  let q;
  try { q = new URLSearchParams(location.search); } catch { return null; }
  const code = q.get("code"), err = q.get("error");
  if (!code && !err) return null;

  const state = q.get("state");
  let saved = null;
  try { saved = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY); } catch { /* 저장 불가 환경 */ }
  clean();

  if (err) return { ok: false, error: err === "access_denied" ? "denied" : err };
  /* state 를 저장 못 한 환경(시크릿 창 등)이면 비교를 건너뛴다 */
  if (saved && state !== saved) return { ok: false, error: "state" };
  if (!enabled()) return { ok: false, error: "no_api" };

  try {
    const r = await fetch(api("/auth/kakao"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri: CONFIG.SITE_URL })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok || !d.token) return { ok: false, error: d.error || "login_failed" };
    store.set(KEY, { token: d.token, uid: d.uid, exp: d.exp });
    return { ok: true };
  } catch { return { ok: false, error: "network" }; }
}

/* 내 기준 위치 읽기·저장. place 를 주면 저장하고, 안 주면 읽기만 한다 */
export async function me(place) {
  const s = session();
  if (!s) return { ok: false, error: "login" };
  const body = place === undefined ? { token: s.token } : { token: s.token, place };
  try {
    const r = await fetch(api("/me"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (r.status === 401) { logout(); return { ok: false, error: "login" }; }
    const d = await r.json().catch(() => ({}));
    return typeof d.ok === "boolean" ? d : { ok: false, error: "server" };
  } catch { return { ok: false, error: "network" }; }
}

/* 내가 남긴 평가. remove 에 카카오ID 를 주면 그 한 줄을 지운다 */
export async function my(remove) {
  const s = session();
  if (!s) return { ok: false, error: "login" };
  const body = remove ? { token: s.token, remove } : { token: s.token };
  try {
    const r = await fetch(api("/my"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (r.status === 401) { logout(); return { ok: false, error: "login" }; }
    const d = await r.json().catch(() => ({}));
    return typeof d.ok === "boolean" ? d : { ok: false, error: "server" };
  } catch { return { ok: false, error: "network" }; }
}

/* 투표방. path 는 "" | "/get" | "/vote" | "/close" */
export async function room(path, body = {}) {
  const s = session();
  if (!s) return { ok: false, error: "login" };
  try {
    const r = await fetch(api("/room" + path), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token: s.token })
    });
    if (r.status === 401) { logout(); return { ok: false, error: "login" }; }
    const d = await r.json().catch(() => ({}));
    return typeof d.ok === "boolean" ? d : { ok: false, error: "server" };
  } catch { return { ok: false, error: "network" }; }
}

/* 로그인한 사람의 평가를 Worker 로 보낸다. 폼과 달리 성공·실패를 알 수 있다 */
export async function postRate(payload) {
  const s = session();
  if (!s) return { ok: false, error: "login" };
  try {
    const r = await fetch(api("/rate"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, token: s.token })
    });
    if (r.status === 401) { logout(); return { ok: false, error: "login" }; }
    const d = await r.json().catch(() => ({}));
    return typeof d.ok === "boolean" ? d : { ok: false, error: "server" };
  } catch { return { ok: false, error: "network" }; }
}

/* 사람에게 보여줄 말. 원인 문자열은 Worker·카카오가 준 것 */
export function reason(error) {
  return {
    denied: "로그인을 취소했어요.",
    state: "로그인이 꼬였어요. 다시 시도해 주세요.",
    network: "서버에 닿지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    no_api: "로그인 서버가 아직 연결되지 않았어요.",
    login: "로그인이 풀렸어요. 다시 로그인해 주세요.",
    kakao_token: "카카오 인증이 만료됐어요. 다시 시도해 주세요.",
    bad_request: "로그인 주소 설정이 어긋났어요. 관리자에게 알려주세요."
  }[error] || "로그인에 실패했어요. 다시 시도해 주세요.";
}

function clean() {
  const u = new URL(location.href);
  ["code", "state", "error", "error_description"].forEach(k => u.searchParams.delete(k));
  history.replaceState(null, "", u.pathname + u.search + u.hash);
}
const rand = () => [...crypto.getRandomValues(new Uint8Array(12))]
  .map(b => b.toString(16).padStart(2, "0")).join("");
