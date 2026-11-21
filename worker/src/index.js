/* ═══════════════════════════════════════════════════
   회식각 API — Cloudflare Worker

   하는 일
     POST /auth/kakao     카카오 인가 코드 → 회식각 세션 토큰
     POST /me             내 기준 위치(우리 회사) 읽기·저장
     GET  /rows           기준 위치 반경 안의 평가 행 (D1)
     POST /my             내가 남긴 평가 보기·한 줄 지우기
     POST /rate           로그인한 사람의 별점을 D1 에 쓴다
     GET|POST /kakao/unlink   카카오 "연결 끊기 웹훅"
     POST /kakao/events   카카오 "계정 상태 변경 웹훅" (SET, RFC 8417/8935)

   저장소
     평가·가게는 D1(SQLite). 기준 위치는 KV. 구글 시트는 더 쓰지 않는다.

   개인정보
     카카오 회원번호는 저장하지 않는다. HMAC(SESSION_SECRET, 회원번호)로 만든 uid 만 ratings.author 에 들어간다.
     웹훅으로 회원번호가 오면 같은 방식으로 uid 를 만들어 그 사람의 평가를 지운다.
     프로필·이메일 같은 동의항목은 받지 않는다. 카카오 토큰도 보관하지 않는다.

   설정 (wrangler.toml 의 vars + `wrangler secret put`)
     vars:    ALLOWED_ORIGINS, REDIRECT_URIS, KAKAO_APP_ID
     secrets: KAKAO_REST_KEY, KAKAO_CLIENT_SECRET(콘솔에서 켜져 있으면), KAKAO_ADMIN_KEY,
              SESSION_SECRET
     D1:      DB — 가게·평가 (worker/schema.sql)
     KV:      PROFILE — 사용자가 등록한 기준 위치. 없으면 /me 가 501 을 돌려준다
              REVOKED (선택) — 세션 강제 만료 기록. 없으면 만료만 못 시키고 나머지는 동작한다
   ═══════════════════════════════════════════════════ */

const SESSION_DAYS = 30;
const KAKAO_ISS = "https://kauth.kakao.com";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      switch (url.pathname) {
        case "/auth/kakao": if (req.method === "POST") return withCors(await login(req, env), cors); break;
        case "/me": if (req.method === "POST") return withCors(await me(req, env), cors); break;
        case "/rows": if (req.method === "GET") return withCors(await rows(req, env), cors); break;
        case "/my": if (req.method === "POST") return withCors(await my(req, env), cors); break;
        case "/rate": if (req.method === "POST") return withCors(await rate(req, env), cors); break;
        case "/kakao/unlink": return await unlinkHook(req, env, ctx);
        case "/kakao/events": if (req.method === "POST") return await eventsHook(req, env, ctx); break;
        case "/": return new Response("hoesikgak api ok");
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error(e);
      return withCors(json({ ok: false, error: "server" }, 500), cors);
    }
  }
};

/* ── 로그인 ─────────────────────────────────── */
async function login(req, env) {
  const { code, redirectUri } = await req.json().catch(() => ({}));
  if (!code || !list(env.REDIRECT_URIS).includes(redirectUri))
    return json({ ok: false, error: "bad_request" }, 400);

  const form = new URLSearchParams({ grant_type: "authorization_code", client_id: env.KAKAO_REST_KEY,
    redirect_uri: redirectUri, code });
  if (env.KAKAO_CLIENT_SECRET) form.set("client_secret", env.KAKAO_CLIENT_SECRET);
  const tr = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: form });
  const tok = await tr.json();
  if (!tr.ok || !tok.access_token) {
    console.warn("token exchange failed", tok.error_code || tok.error, tok.error_description);
    return json({ ok: false, error: "kakao_token" }, 401);
  }
  const ur = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const me = await ur.json();
  if (!ur.ok || !me.id) return json({ ok: false, error: "kakao_user" }, 401);

  const uid = await uidOf(env, me.id);
  const now = Math.floor(Date.now() / 1000), exp = now + SESSION_DAYS * 86400;
  return json({ ok: true, uid, exp, token: await sign(env, { uid, iat: now, exp }) });
}

/* ── 내 기준 위치 ───────────────────────────
   {token}            → 저장된 위치를 돌려준다
   {token, place:{…}} → 저장하고 돌려준다
   좌표는 대한민국 범위만 받는다. 저장하는 건 이름·주소·좌표뿐 */
async function me(req, env) {
  const body = await req.json().catch(() => null);
  const s = body && await verifySession(env, body.token);
  if (!s) return json({ ok: false, error: "login" }, 401);
  if (!env.PROFILE) return json({ ok: false, error: "no_store" }, 501);
  const key = "place:" + s.uid;

  if (body.place !== undefined) {
    const p = cleanPlace(body.place);
    if (!p) return json({ ok: false, error: "bad_place" }, 400);
    await env.PROFILE.put(key, JSON.stringify(p));
    return json({ ok: true, place: p });
  }
  const saved = await env.PROFILE.get(key, "json");
  return json({ ok: true, place: saved || null });
}
function cleanPlace(v) {
  if (!v || typeof v !== "object") return null;
  const name = String(v.name || "").trim().slice(0, 60);
  const addr = String(v.addr || "").trim().slice(0, 120);
  const lat = +v.lat, lng = +v.lng;
  if (!name || !(lat >= 33 && lat <= 39) || !(lng >= 124 && lng <= 132)) return null;
  return { name, addr, lat, lng };
}

/* ── 기준 위치 반경의 평가 행 ─────────────────
   GET /rows?lat=&lng=&r=
   가게·평가를 붙여서 그대로 돌려준다. 집계는 브라우저가 한다(테스트가 붙어 있는 쪽).
   경계 상자로만 자르고 정확한 거리는 화면이 다시 잰다 */
const MAX_RADIUS = 20000;
async function rows(req, env) {
  const q = new URL(req.url).searchParams;
  const lat = +q.get("lat"), lng = +q.get("lng");
  const r = Math.min(Math.max(+q.get("r") || 1500, 100), MAX_RADIUS);
  if (!isFinite(lat) || !isFinite(lng)) return json({ ok: false, error: "bad_request" }, 400);
  if (!env.DB) return json({ ok: false, error: "no_db" }, 501);

  const dLat = r / 111320;
  const dLng = r / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  const { results } = await env.DB.prepare(
    `SELECT p.kakao_id, p.name, p.cat, p.kcat, p.addr, p.lat, p.lng,
            r.author, r.score, r.budget, r.room, r.parking, r.noise, r.fit, r.text, r.closed, r.req_id
       FROM places p JOIN ratings r ON r.kakao_id = p.kakao_id
      WHERE p.lat BETWEEN ?1 AND ?2 AND p.lng BETWEEN ?3 AND ?4`
  ).bind(lat - dLat, lat + dLat, lng - dLng, lng + dLng).all();

  return json({ ok: true, rows: (results || []).map(x => ({
    kakaoId: x.kakao_id, name: x.name, cat: x.cat, kcat: x.kcat, addr: x.addr,
    lat: x.lat, lng: x.lng, author: x.author, score: x.score, budget: x.budget,
    room: x.room, parking: x.parking, noise: x.noise, fit: x.fit,
    text: x.text, closed: x.closed, reqId: x.req_id
  })) });
}

/* ── 내가 남긴 평가 ─────────────────────────
   {token}                    → 내 평가 전부
   {token, remove:"카카오ID"}  → 그 가게에 남긴 내 평가 한 줄 지우기 */
async function my(req, env) {
  const body = await req.json().catch(() => null);
  const s = body && await verifySession(env, body.token);
  if (!s) return json({ ok: false, error: "login" }, 401);
  if (!env.DB) return json({ ok: false, error: "no_db" }, 501);

  if (body.remove) {
    const id = String(body.remove).replace(/\D/g, "");
    if (!id) return json({ ok: false, error: "bad_request" }, 400);
    const r = await env.DB.prepare("DELETE FROM ratings WHERE author = ?1 AND kakao_id = ?2")
      .bind(s.uid, id).run();
    return json({ ok: true, deleted: (r.meta && r.meta.changes) || 0 });
  }
  const { results } = await env.DB.prepare(
    `SELECT p.kakao_id, p.name, p.cat, p.addr, p.lat, p.lng,
            r.score, r.budget, r.text, r.closed, r.created_at
       FROM ratings r JOIN places p ON p.kakao_id = r.kakao_id
      WHERE r.author = ?1 ORDER BY r.created_at DESC`
  ).bind(s.uid).all();
  return json({ ok: true, ratings: (results || []).map(x => ({
    kakaoId: x.kakao_id, name: x.name, cat: x.cat, addr: x.addr, lat: x.lat, lng: x.lng,
    score: x.score, budget: x.budget, text: x.text, closed: x.closed, createdAt: x.created_at
  })) });
}


/* ── 별점 ──────────────────────────────────── */
const PER_HOUR = 40;
async function rate(req, env) {
  const body = await req.json().catch(() => null);
  const s = body && await verifySession(env, body.token);
  if (!s) return json({ ok: false, error: "login" }, 401);
  if (!env.DB) return json({ ok: false, error: "no_db" }, 501);

  const d = body, id = String(d.kakaoId || "").replace(/\D/g, "");
  const lat = +d.lat, lng = +d.lng;
  if (!id || !d.name || !isFinite(lat) || !isFinite(lng))
    return json({ ok: false, error: "bad_request" }, 400);
  const closed = d.closed ? 1 : 0;
  const score = d.score === "" || d.score === null || d.score === undefined ? null : Number(d.score);
  if (score !== null && !(score >= 0 && score <= 5)) return json({ ok: false, error: "bad_score" }, 400);
  if (score === null && !closed) return json({ ok: false, error: "no_score" }, 400);

  /* 도배 막기 — 한 시간에 PER_HOUR 줄까지 */
  const since = Math.floor(Date.now() / 1000) - 3600;
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ratings WHERE author = ?1 AND created_at > ?2")
    .bind(s.uid, since).first();
  if (n && n.n >= PER_HOUR) return json({ ok: false, error: "too_many" }, 429);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO places (kakao_id, name, cat, kcat, addr, lat, lng) VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(kakao_id) DO UPDATE SET
           name = excluded.name, cat = excluded.cat, kcat = excluded.kcat,
           addr = excluded.addr, lat = excluded.lat, lng = excluded.lng`
    ).bind(id, clip(d.name, 60), clip(d.cat, 20), clip(d.kcat, 80), clip(d.addr, 120), lat, lng),
    env.DB.prepare(
      `INSERT INTO ratings (kakao_id, author, score, budget, room, parking, noise, fit, text, closed, req_id, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(kakao_id, author) DO UPDATE SET
           score = excluded.score, budget = excluded.budget, room = excluded.room,
           parking = excluded.parking, noise = excluded.noise, fit = excluded.fit,
           text = excluded.text, closed = excluded.closed, req_id = excluded.req_id,
           created_at = excluded.created_at`
    ).bind(id, s.uid, score, Number(d.budget) || null,
      pick1(d.room, ["있음", "없음"]), pick1(d.parking, ["가능", "불가"]),
      pick1(d.noise, ["조용", "보통", "시끄러움"]),
      pick1(d.fit, ["4명 이하", "5~8명", "9~12명", "13~20명", "20명 이상"]),
      clip(d.text, 300), closed, clip(d.reqId, 60), Math.floor(Date.now() / 1000))
  ]);
  return json({ ok: true });
}
const clip = (v, n) => String(v ?? "").slice(0, n);
const pick1 = (v, allowed) => allowed.includes(String(v ?? "")) ? String(v) : null;

/* ── 연결 끊기 웹훅 ─────────────────────────────
   GET 이면 쿼리, POST 면 폼 본문으로 app_id, user_id, referrer_type 이 온다.
   카카오는 오류가 나도 3초 안에 200 을 달라고 한다. 처리는 waitUntil 로 응답 뒤에 한다 */
async function unlinkHook(req, env, ctx) {
  if (req.headers.get("Authorization") !== `KakaoAK ${env.KAKAO_ADMIN_KEY}`)
    return new Response("unauthorized", { status: 401 });
  let p = new URL(req.url).searchParams;
  if (req.method === "POST") p = new URLSearchParams(await req.text());
  const userId = p.get("user_id"), appId = p.get("app_id");
  if (userId && (!env.KAKAO_APP_ID || appId === String(env.KAKAO_APP_ID)))
    ctx.waitUntil(forget(env, userId, "unlink:" + (p.get("referrer_type") || "")));
  return new Response("OK", { status: 200 });
}

/* ── 계정 상태 변경 웹훅 (SET) ──────────────────
   본문은 JWT 문자열 하나. 검증 실패는 400 + {err, description}, 성공은 202 본문 없음 */
const FORGET_EVENTS = [
  "https://schemas.openid.net/secevent/oauth/event-type/user-unlinked",
  "https://schemas.openid.net/secevent/risc/event-type/account-purged"
];
const REVOKE_EVENTS = [
  "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
  "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  "https://schemas.openid.net/secevent/risc/event-type/credential-compromise"
];
async function eventsHook(req, env, ctx) {
  const fail = (err, description) => json({ err, description }, 400);
  const jwt = (await req.text()).trim();
  const parts = jwt.split(".");
  if (parts.length !== 3) return fail("invalid_request", "SET is not a JWT");
  let header, payload;
  try { header = JSON.parse(b64text(parts[0])); payload = JSON.parse(b64text(parts[1])); }
  catch { return fail("invalid_request", "SET could not be decoded"); }
  if (header.alg !== "RS256" || !header.kid) return fail("invalid_request", "unsupported alg or missing kid");
  if (payload.iss !== KAKAO_ISS) return fail("invalid_issuer", `unexpected iss ${payload.iss}`);
  /* 문서의 클레임 표는 aud 를 REST API 키로, 오류 표는 앱 ID 로 적고 있다. 둘 다 받아준다 */
  const auds = [].concat(payload.aud || []).map(String);
  if (!auds.some(a => a === env.KAKAO_REST_KEY || a === String(env.KAKAO_APP_ID)))
    return fail("invalid_audience", "aud does not match this app");
  const key = await kakaoKey(header.kid);
  if (!key) return fail("invalid_key", `unknown kid ${header.kid}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64bytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return fail("invalid_key", "signature verification failed");

  ctx.waitUntil((async () => {
    for (const [type, ev] of Object.entries(payload.events || {})) {
      const sub = ev?.subject?.sub || payload.sub;
      if (!sub) continue;
      if (FORGET_EVENTS.includes(type)) await forget(env, sub, type.split("/").pop());
      else if (REVOKE_EVENTS.includes(type)) await revoke(env, await uidOf(env, sub));
    }
  })());
  return new Response(null, { status: 202 });
}

/* 공개키는 자주 받지 말라고 한다. 한 시간 캐시 */
let JWKS = null, JWKS_AT = 0;
async function kakaoKey(kid) {
  const fresh = Date.now() - JWKS_AT < 3600e3;
  if (!JWKS || !fresh || !JWKS.keys.some(k => k.kid === kid)) {
    const conf = await (await fetch(`${KAKAO_ISS}/.well-known/ssf-configuration`)).json().catch(() => ({}));
    const uri = conf.jwks_uri || `${KAKAO_ISS}/.well-known/jwks.json`;
    JWKS = await (await fetch(uri)).json(); JWKS_AT = Date.now();
  }
  const jwk = JWKS.keys.find(k => k.kid === kid);
  return jwk && crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

/* ── 지우기 · 세션 만료 ──────────────────────── */
async function forget(env, kakaoUserId, reason) {
  const uid = await uidOf(env, kakaoUserId);
  await revoke(env, uid);
  if (env.PROFILE) await env.PROFILE.delete("place:" + uid);   // 등록한 기준 위치도 같이 지운다
  if (!env.DB) return console.error("forget: DB 없음", uid);
  /* 가게 정보는 개인정보가 아니라 남긴다. 그 사람이 쓴 평가만 지운다 */
  const r = await env.DB.prepare("DELETE FROM ratings WHERE author = ?1").bind(uid).run();
  console.log("forget", uid, reason, r.meta && r.meta.changes);
}
async function revoke(env, uid) {
  if (env.REVOKED) await env.REVOKED.put("rev:" + uid, String(Math.floor(Date.now() / 1000)),
    { expirationTtl: SESSION_DAYS * 86400 + 86400 });
}


/* ── 세션 토큰: base64url(JSON).base64url(HMAC) ── */
async function hmac(env, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
async function uidOf(env, kakaoUserId) {
  const h = await hmac(env, "uid:" + kakaoUserId);
  return "k_" + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sign(env, obj) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(obj)));
  return body + "." + b64url(await hmac(env, body));
}
async function verifySession(env, token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!timingSafeEqual(sig, b64url(await hmac(env, body)))) return null;
  let s; try { s = JSON.parse(b64text(body)); } catch { return null; }
  if (!s.uid || s.exp < Date.now() / 1000) return null;
  if (env.REVOKED) {
    const rev = await env.REVOKED.get("rev:" + s.uid);
    if (rev && s.iat <= +rev) return null;
  }
  return s;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ── 잡일 ──────────────────────────────────── */
const list = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);
function corsHeaders(req, env) {
  const o = req.headers.get("Origin") || "";
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
  if (list(env.ALLOWED_ORIGINS).includes(o)) h["Access-Control-Allow-Origin"] = o;
  return h;
}
function withCors(res, cors) { Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v)); return res; }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64bytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const b64text = s => new TextDecoder().decode(b64bytes(s));

export const _test = { uidOf, sign, verifySession, eventsHook, unlinkHook, b64url };
