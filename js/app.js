/* ═══════════════════════════════════════════════════
   시작점 — 해시 라우팅과 화면끼리 나눠 쓰는 상태(ctx)
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import { parseHash, buildHash } from "./router.js";
import { applyTheme, toggleTheme } from "./theme.js";
import { loadPlaces, currentPlaces, closedIds, db } from "./data.js";
import { loadMaps, geocodeOffices, resolveLegacy } from "./kakao.js";
import { toast } from "./share.js";
import { $ } from "./util.js";
import * as home from "./views/home.js";
import * as setup from "./views/setup.js";
import * as picks from "./views/picks.js";
import * as spin from "./views/spin.js";
import * as mapView from "./views/map.js";
import * as sheet from "./views/sheet.js";

const VIEWS = { home, setup, picks, spin, map: mapView };
const OFFICES = CONFIG.OFFICES.map(o => ({ ...o }));
const ME = { key: "me", name: "내 위치", lat: 0, lng: 0 };

export const ctx = {
  view: "home", cond: {}, meal: null,
  offices: OFFICES, me: null,
  places: [],
  closed: new Set(),  // 문 닫았다는 신고가 모인 카카오ID — 주변 검색 결과에서도 뺀다
  dataOk: false,
  ready: null,        // 시트를 다 읽으면 끝나는 Promise
  mapsOk: null,       // 지도 SDK 가 뜨면 true
  go(view, cond = ctx.cond) { const h = buildHash(view, cond); if (location.hash === h) render(); else location.hash = h; },
  replace(view, cond) { history.replaceState(null, "", buildHash(view, cond)); ctx.cond = cond; },
  /* 기준 위치 객체. "me" 면 위치를 묻고, 실패하면 기본 사옥으로 */
  async base(at) {
    if (at === "me") {
      if (ctx.me) return ctx.me;
      try {
        const pos = await new Promise((ok, no) => navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
          : no(new Error("unsupported")));
        ctx.me = { ...ME, lat: pos.coords.latitude, lng: pos.coords.longitude };
        return ctx.me;
      } catch (e) {
        toast(e && e.code === 1 ? "위치 권한이 꺼져 있어요. 사옥 기준으로 보여드릴게요." : "위치를 못 찾았어요. 사옥 기준으로 보여드릴게요.");
        return ctx.office(CONFIG.DEFAULT_OFFICE);
      }
    }
    return ctx.office(at);
  },
  office: key => OFFICES.find(o => o.key === key) || OFFICES.find(o => o.key === CONFIG.DEFAULT_OFFICE) || OFFICES[0],
  defaultAt: () => ctx.cond.at || CONFIG.DEFAULT_OFFICE,
  refresh() { ctx.places = currentPlaces(); ctx.closed = closedIds(db.rows); },
  openSheet: p => sheet.open(p, ctx),
  closeSheet: () => sheet.close(),
  rerender: () => render()
};

let seq = 0;
async function render() {
  const { view, cond } = parseHash(location.hash);
  ctx.view = view; ctx.cond = cond;
  sheet.close();
  document.body.dataset.view = view;
  $("#mapBtn").setAttribute("aria-pressed", String(view === "map"));
  const my = ++seq;
  const root = $("#view");
  root.className = view === "picks" || view === "map" ? "wide" : "";
  try { await VIEWS[view].render(root, ctx, () => my === seq); }
  catch (e) { console.error(e); root.innerHTML = `<div class="wrap empty"><b>문제가 생겼어요</b>새로고침해 주세요.</div>`; }
  if (view !== "spin") window.scrollTo(0, 0);
}

function boot() {
  applyTheme();
  const t = $("#themeBtn");
  const syncTheme = () => { t.textContent = document.documentElement.dataset.theme === "night" ? "☀️" : "🌙"; };
  syncTheme();
  t.onclick = () => { toggleTheme(); syncTheme(); };
  $("#mapBtn").onclick = () => ctx.go("map", { at: ctx.defaultAt() });
  const words = CONFIG.MARQUEE.join("  ·  ");
  $("#marq").textContent = `${words}  ·  ${words}  ·  `;

  ctx.ready = loadPlaces().then(ok => { ctx.dataOk = ok; ctx.refresh(); });
  /* 지도가 뜨면 사옥 좌표를 바로잡고, 옛 데이터의 위치를 이름으로 찾아 다시 그린다 */
  ctx.mapsOk = loadMaps().then(async ok => {
    if (!ok) return false;
    await geocodeOffices(OFFICES);
    await ctx.ready;
    if (db.legacy.some(p => !p.lat) && await resolveLegacy(db.legacy, OFFICES)) {
      ctx.refresh();
      if (ctx.view === "picks" || ctx.view === "map") render();
    }
    return true;
  });

  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", e => { if (e.key === "Escape") sheet.close(); });
  $("#scrim").onclick = () => sheet.close();
  render();
}
boot();
