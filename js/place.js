/* ═══════════════════════════════════════════════════
   내 기준 위치 — 로그인한 사람이 직접 등록한 "우리 회사"

   서버(Worker KV)에 uid 로 저장해서 폰·PC 어디서 로그인해도 따라온다.
   브라우저에도 한 벌 캐시해 두어 새로고침할 때 화면이 비는 일이 없게 한다.
   저장하는 값은 이름·주소·좌표뿐이다.
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import * as store from "./store.js";
import * as auth from "./auth.js";
import { loadMaps } from "./kakao.js";
import { esc } from "./util.js";

const KEY = "hoesik.myplace";

/* 화면에서 바로 쓰는 값. 서버에서 받아오기 전에도 캐시가 있으면 그걸 쓴다 */
export const myPlace = () => store.get(KEY, null);
export const hasPlace = () => !!(myPlace() && myPlace().lat);

/* 기준 위치 객체(= ctx.base 가 돌려주는 모양)로 바꾼다 */
export function asBase(p = myPlace()) {
  return p && p.lat ? { key: "my", name: p.name, addr: p.addr || "", lat: p.lat, lng: p.lng } : null;
}

/* 서버에 저장된 걸 받아 캐시를 맞춘다. 로그인 전이거나 서버가 없으면 캐시를 그대로 둔다 */
export async function pull() {
  if (!auth.enabled() || !auth.loggedIn()) return myPlace();
  const r = await auth.me();
  if (!r.ok) return myPlace();            // 서버가 잠깐 안 되면 캐시로 버틴다
  if (r.place) store.set(KEY, r.place); else store.del(KEY);
  return r.place || null;
}

/* 등록·수정. 서버에 먼저 쓰고 성공하면 캐시에 넣는다 */
export async function save(place) {
  const clean = {
    name: String(place.name || "").slice(0, 60),
    addr: String(place.addr || "").slice(0, 120),
    lat: +place.lat, lng: +place.lng
  };
  if (!clean.name || !isFinite(clean.lat) || !isFinite(clean.lng)) throw new Error("bad_place");
  if (auth.enabled()) {
    const r = await auth.me(clean);
    if (!r.ok) throw new Error(r.error || "save_failed");
  }
  store.set(KEY, clean);
  return clean;
}

export function forget() { store.del(KEY); }

/* ── 주소 검색 (카카오 우편번호 서비스) ────────
   키가 필요 없고 건물명으로도 찾아준다. 지도 SDK 와 전역이 겹치지 않는 걸 확인했다.
   좌표는 안 주므로 고른 주소를 지도 SDK 로 한 번 더 좌표로 바꾼다 */
const POSTCODE_SRC = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
let pcLoad = null;
function loadPostcode() {
  if (pcLoad) return pcLoad;
  pcLoad = new Promise(resolve => {
    if (window.daum && window.daum.Postcode) return resolve(true);
    const s = document.createElement("script");
    s.src = POSTCODE_SRC;
    s.onload = () => resolve(!!(window.daum && window.daum.Postcode));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return pcLoad;
}

/* host 안에 주소 검색창을 띄운다. 고르면 {addr, name} 을 돌려준다 */
export async function pickAddress(host) {
  if (!(await loadPostcode())) throw new Error("no_postcode");
  return new Promise(resolve => {
    new daum.Postcode({
      oncomplete: data => resolve({
        /* 사용자가 지번을 골랐으면 지번으로 */
        addr: data.userSelectedType === "J" ? (data.jibunAddress || data.address) : (data.roadAddress || data.address),
        name: data.buildingName || ""
      }),
      width: "100%", height: "100%"
    }).embed(host, { autoClose: false });
  });
}

/* 주소 → 좌표 */
export async function geocode(addr) {
  if (!addr || !(await loadMaps())) return null;
  const geo = new kakao.maps.services.Geocoder();
  return new Promise(done => geo.addressSearch(addr, (res, st) =>
    done(st === kakao.maps.services.Status.OK && res[0] ? { lat: +res[0].y, lng: +res[0].x } : null)));
}

/* 지금 서 있는 자리를 기준으로 삼고 싶을 때 */
export function here() {
  return new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      pos => ok({ name: "현재 위치", addr: "", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      no, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

export const NEAR = CONFIG.NEAR_RADIUS;
