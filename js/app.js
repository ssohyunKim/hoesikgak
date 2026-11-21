/* ═══════════════════════════════════════════════════
   시작점 — 해시 라우팅과 화면끼리 나눠 쓰는 상태(ctx)
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import { parseHash, buildHash } from "./router.js";
import { applyTheme, toggleTheme } from "./theme.js";
import { loadPlaces, currentPlaces, closedIds, db } from "./data.js";
import { loadMaps, geocodeBases, resolveLegacy } from "./kakao.js";
import { toast } from "./share.js";
import * as auth from "./auth.js";
import * as place from "./place.js";
import { $ } from "./util.js";
import * as login from "./views/login.js";
import * as myplace from "./views/myplace.js";
import * as home from "./views/home.js";
import * as setup from "./views/setup.js";
import * as picks from "./views/picks.js";
import * as spin from "./views/spin.js";
import * as mapView from "./views/map.js";
import * as mypage from "./views/mypage.js";
import * as room from "./views/room.js";
import * as sheet from "./views/sheet.js";

const VIEWS = { home, setup, picks, spin, map: mapView, mypage, room };
/* 옛 데이터의 위치를 이름으로 찾을 때만 쓰는 기준점. 화면에는 안 나온다 */
const LEGACY_BASES = (CONFIG.LEGACY_BASES || []).map(o => ({ ...o }));
const ME = { key: "me", name: "내 위치", lat: 0, lng: 0 };
let loadedKey = null, loading = Promise.resolve(false);

export const ctx = {
  view: "home", cond: {}, meal: null,
  me: null,
  places: [],
  closed: new Set(),  // 문 닫았다는 신고가 모인 카카오ID — 주변 검색 결과에서도 뺀다
  dataOk: false,
  ready: null,        // 시트를 다 읽으면 끝나는 Promise
  mapsOk: null,       // 지도 SDK 가 뜨면 true
  go(view, cond = ctx.cond) { const h = buildHash(view, cond); if (location.hash === h) render(); else location.hash = h; },
  replace(view, cond) { history.replaceState(null, "", buildHash(view, cond)); ctx.cond = cond; },
  /* 기준 위치 객체. "me" 면 위치를 묻고, 실패하면 등록해 둔 회사로 */
  async base(at) {
    const mine = place.asBase();
    if (at === "me") {
      if (ctx.me) return ctx.me;
      try {
        const pos = await new Promise((ok, no) => navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
          : no(new Error("unsupported")));
        ctx.me = { ...ME, lat: pos.coords.latitude, lng: pos.coords.longitude };
        return ctx.me;
      } catch (e) {
        if (!mine) throw e;
        toast(e && e.code === 1 ? "위치 권한이 꺼져 있어요. 등록한 회사 기준으로 보여드릴게요." : "위치를 못 찾았어요. 등록한 회사 기준으로 보여드릴게요.");
        return mine;
      }
    }
    return mine || ctx.me || { ...ME };
  },
  /* 기준 칩에 쓸 목록 */
  bases: () => [place.asBase(), { ...ME, name: "📍 내 위치" }].filter(Boolean),
  defaultAt: () => ctx.cond.at || (place.hasPlace() ? "my" : "me"),
  /* 기준 위치를 등록·수정하고 돌아올 때 */
  afterPlace() { ctx.needPlace = false; ctx.go("home", {}); render(); },
  editPlace() { ctx.needPlace = true; render(); },
  needPlace: false,
  refresh() { ctx.places = currentPlaces(); ctx.closed = closedIds(db.rows); },
  /* 기준 위치가 바뀌면 그 주변 평가를 다시 읽는다. 같은 자리면 읽어둔 걸 쓴다.
     (배포 전 = CONFIG.API_BASE 가 비어 있으면 예전처럼 시트 전체를 한 번만 읽는다) */
  load(base) {
    const useApi = !!CONFIG.API_BASE;
    /* D1 을 쓰는데 기준 위치가 아직 없으면 읽을 게 없다. 시트를 괜히 받지 않는다 */
    if (useApi && !(base && base.lat)) return loading;
    const key = useApi ? `${base.lat.toFixed(3)},${base.lng.toFixed(3)}` : "sheet";
    if (key !== loadedKey) {
      loadedKey = key;
      loading = loadPlaces(key === "sheet" ? null : base)
        .then(ok => { ctx.dataOk = ok; ctx.refresh(); return ok; });
    }
    return loading;
  },
  openSheet: p => sheet.open(p, ctx),
  closeSheet: () => sheet.close(),
  rerender: () => render(),
  /* 평가를 고치거나 지우면 읽어둔 주변 데이터가 낡는다. 다음 조회 때 다시 읽게 한다 */
  reload() { loadedKey = null; }
};

/* 로그인이 필요한데 아직 안 했으면 어떤 주소로 와도 로그인 화면만 보여준다.
   쓰는 중에 세션이 만료돼도 여기서 걸린다 */
const gated = () => auth.required() && !auth.loggedIn();

let seq = 0;
async function render() {
  if (gated()) {
    sheet.close();
    document.body.dataset.view = "login";
    const root = $("#view");
    root.className = "";
    return login.render(root, ctx);
  }
  /* 기준 위치가 없으면 먼저 등록받는다. 이게 없으면 후보를 고를 수가 없다 */
  if (ctx.needPlace || !place.hasPlace()) {
    sheet.close();
    document.body.dataset.view = "myplace";
    const root = $("#view");
    root.className = "";
    return myplace.render(root, ctx);
  }
  const { view, cond } = parseHash(location.hash);
  if (ctx.view === "room" && view !== "room") room.leave();   // 표 polling 멈추기
  ctx.view = view; ctx.cond = cond;
  sheet.close();
  document.body.dataset.view = view;
  $("#mapBtn").setAttribute("aria-pressed", String(view === "map"));
  $("#meBtn").setAttribute("aria-pressed", String(view === "mypage"));
  const my = ++seq;
  const root = $("#view");
  root.className = view === "picks" || view === "map" ? "wide" : "";
  try { await VIEWS[view].render(root, ctx, () => my === seq); }
  catch (e) { console.error(e); root.innerHTML = `<div class="wrap empty"><b>문제가 생겼어요</b>새로고침해 주세요.</div>`; }
  if (view !== "spin") window.scrollTo(0, 0);
}

async function boot() {
  applyTheme();
  const t = $("#themeBtn");
  const syncTheme = () => { t.textContent = document.documentElement.dataset.theme === "night" ? "☀️" : "🌙"; };
  syncTheme();
  t.onclick = () => { toggleTheme(); syncTheme(); };
  $("#mapBtn").onclick = () => ctx.go("map", { at: ctx.defaultAt() });
  /* 마이페이지는 로그인했을 때만 의미가 있다 */
  const me = $("#meBtn");
  me.hidden = !auth.enabled();
  me.onclick = () => ctx.go("mypage", {});
  const words = CONFIG.MARQUEE.join("  ·  ");
  $("#marq").textContent = `${words}  ·  ${words}  ·  `;

  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", e => { if (e.key === "Escape") sheet.close(); });
  $("#scrim").onclick = () => sheet.close();

  /* 카카오에서 ?code= 를 달고 돌아온 경우를 먼저 처리한다 */
  const r = await auth.finish();
  if (r && !r.ok) toast(auth.reason(r.error));
  /* 로그인 전에는 시트도 지도도 부르지 않는다. 로그인은 전체 새로고침이라 끝나면 여기부터 다시 돈다 */
  if (gated()) return render();
  /* 서버에 등록해 둔 기준 위치를 받아온다. 다른 기기에서 등록했어도 따라온다 */
  await place.pull();

  ctx.ready = ctx.load(place.asBase());
  /* 지도가 뜨면 옛 데이터의 위치를 이름으로 찾아 다시 그린다 */
  ctx.mapsOk = loadMaps().then(async ok => {
    if (!ok) return false;
    await geocodeBases(LEGACY_BASES);
    await ctx.ready;
    if (db.legacy.some(p => !p.lat) && await resolveLegacy(db.legacy, LEGACY_BASES)) {
      ctx.refresh();
      if (ctx.view === "picks" || ctx.view === "map") render();
    }
    return true;
  });

  render();
}
boot();
