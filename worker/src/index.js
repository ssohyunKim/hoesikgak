/* ═══════════════════════════════════════════════════
   회식각 API — Cloudflare Worker

   하는 일
     POST /auth/kakao     카카오 인가 코드 → 회식각 세션 토큰
     POST /rate           로그인한 사람의 별점을 구글 시트(Apps Script)로 넘긴다
     GET|POST /kakao/unlink   카카오 "연결 끊기 웹훅"
     POST /kakao/events   카카오 "계정 상태 변경 웹훅" (SET, RFC 8417/8935)

   왜 Apps Script 가 아니라 여기인가
     카카오 웹훅은 3초 안에 200/202 로 답해야 하고, 연결 끊기 웹훅은 Authorization 헤더로 검증해야 한다.
     Apps Script 웹 앱은 요청 헤더를 못 읽고 응답이 항상 302 리다이렉트라 둘 다 못 한다.

   개인정보
     카카오 회원번호는 저장하지 않는다. HMAC(SESSION_SECRET, 회원번호)로 만든 uid 만 시트 "작성자" 칸에 들어간다.
     웹훅으로 회원번호가 오면 같은 방식으로 uid 를 만들어 그 사람의 평가를 지운다.
     프로필·이메일 같은 동의항목은 받지 않는다. 카카오 토큰도 보관하지 않는다.

   설정 (wrangler.toml 의 vars + `wrangler secret put`)
     vars:    ALLOWED_ORIGINS, REDIRECT_URIS, KAKAO_APP_ID
     secrets: KAKAO_REST_KEY, KAKAO_CLIENT_SECRET(콘솔에서 켜져 있으면), KAKAO_ADMIN_KEY,
              SESSION_SECRET, SHEET_URL, SHEET_SECRET
     KV:      REVOKED (선택) — 세션 강제 만료 기록. 없으면 만료만 못 시키고 나머지는 동작한다
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

/* ── 별점 ──────────────────────────────────── */
async function rate(req, env) {
  const body = await req.json().catch(() => null);
  const s = body && await verifySession(env, body.token);
  if (!s) return json({ ok: false, error: "login" }, 401);
  const { token, ...payload } = body;
  const r = await toSheet(env, { ...payload, action: "rate", author: s.uid });
  return json(r, r.ok ? 200 : 400);
}

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
  const r = await toSheet(env, { action: "forget", author: uid, reason });
  if (!r.ok) console.error("forget failed", uid, r.error);
}
async function revoke(env, uid) {
  if (env.REVOKED) await env.REVOKED.put("rev:" + uid, String(Math.floor(Date.now() / 1000)),
    { expirationTtl: SESSION_DAYS * 86400 + 86400 });
}

/* Apps Script 는 POST 에 302 로 답한다. fetch 가 따라가서 최종 JSON 을 읽는다 */
async function toSheet(env, data) {
  const r = await fetch(env.SHEET_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...data, secret: env.SHEET_SECRET }), redirect: "follow" });
  return r.json().catch(() => ({ ok: false, error: "sheet_response" }));
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
  const h = { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
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
