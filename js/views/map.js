/* 🗺 지도 탐색 — 마법사와 상관없이 둘러보고 평가하는 곳. 비추 명단도 여기서 본다 */
import { CONFIG } from "../config.js";
import { distOf } from "../util.js";
import { nearby, makeMap, setPins } from "../kakao.js";
import { cardHtml, pinEl, baseEl } from "./pins.js";

const FILTERS = [["all", "전체"], ["good", "추천"], ["new", "평가 없음"], ["bad", "비추"]];
let filter = "all";
const withTimeout = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);

export async function render(root, ctx, alive) {
  const at = ctx.cond.at || ctx.defaultAt();
  root.innerHTML = `<div class="wrap"><div class="empty"><b>지도를 준비하는 중…</b></div></div>`;
  const base = await ctx.base(at);
  await ctx.load(base);
  const mapsOk = await withTimeout(ctx.mapsOk, 7000, false);
  const near = (mapsOk ? await withTimeout(nearby(base), 8000, []) : []).filter(p => !ctx.closed.has(p.kakaoId));
  if (!alive()) return;

  const inRange = p => !!(p.lat && p.lng) && distOf(base.lat, base.lng, p.lat, p.lng) <= CONFIG.NEAR_RADIUS;
  const known = ctx.places.filter(inRange).map(p => ({ ...p, dist: p.lat ? distOf(base.lat, base.lng, p.lat, p.lng) : null }));
  const ids = new Set(known.map(p => p.kakaoId));
  const all = known.concat(near.filter(p => !ids.has(p.kakaoId)));
  const pick = {
    all: () => all,
    good: () => all.filter(p => p.rated && p.rec !== false && p.score >= CONFIG.ROULETTE_MIN),
    new: () => all.filter(p => !p.rated),
    bad: () => all.filter(p => p.rec === false),
  };
  const count = k => pick[k]().length;
  const shown = () => pick[filter]().slice().sort((a, b) =>
    (b.rated - a.rated) || (a.rated ? b.score - a.score : (a.dist ?? 9e9) - (b.dist ?? 9e9)));

  root.innerHTML = `<div class="wrap">
    <div class="phead"><h2>${base.key === "me" ? "내 위치" : base.name} 주변</h2></div>
    <div class="chips" id="bases">${ctx.bases().map(o =>
      `<button class="chip sm" data-at="${o.key}" aria-pressed="${at === o.key}">${o.name}</button>`).join("")}
      <button class="chip sm" data-at="edit">✏️ 기준 바꾸기</button></div>
    <div class="mapfilters" id="filters">${FILTERS.map(([k, l]) =>
      `<button class="chip sm" data-f="${k}" aria-pressed="${filter === k}">${l} ${count(k)}</button>`).join("")}</div>
    <div class="picks-split">
      <div class="mapbox" id="mapBox"><div class="msg">${mapsOk ? "" : "지도를 불러오지 못했어요.<br>카카오 콘솔에 이 도메인이 등록됐는지 확인해 주세요."}</div></div>
      <div class="plist" id="list" style="margin-top:12px"></div>
    </div>
  </div>`;

  const q = s => root.querySelector(s);
  let map = null;
  const draw = () => {
    const items = shown();
    q("#list").innerHTML = items.length ? items.slice(0, 60).map(p => cardHtml(p)).join("")
      : `<div class="empty"><b>${filter === "bad" ? "비추로 올라온 곳이 없어요" : "표시할 곳이 없어요"}</b></div>`;
    q("#filters").querySelectorAll("[data-f]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
    if (!mapsOk) return;
    if (!map) { q("#mapBox").innerHTML = ""; map = makeMap(q("#mapBox"), base); }
    const pins = items.map(p => ({ lat: p.lat, lng: p.lng, el: pinEl(p, () => ctx.openSheet(p)) }));
    pins.push({ lat: base.lat, lng: base.lng, el: baseEl(base) });
    setPins(map, pins, { fit: items.length > 0, center: base });
  };
  draw();
  q("#filters").onclick = e => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; draw(); } };
  q("#bases").onclick = e => {
    const b = e.target.closest("[data-at]"); if (!b) return;
    if (b.dataset.at === "edit") return ctx.editPlace();
    ctx.go("map", { at: b.dataset.at });
  };
  q("#list").onclick = e => { const c = e.target.closest(".pc"); if (c) ctx.openSheet(all.find(p => p.id === c.dataset.id)); };
}
