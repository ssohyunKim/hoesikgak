/* ③ 후보 — 목록 ⇄ 지도, ✕ 빼기, 하단 🎡 룰렛 */
import { CONFIG } from "../config.js";
import { buildPicks } from "../picks.js";
import { situationOf, budgetOf } from "../situations.js";
import { nearby, makeMap, setPins } from "../kakao.js";
import { cardHtml, pinEl, baseEl } from "./pins.js";
import * as auth from "../auth.js";
import { toast } from "../share.js";
import { unesc } from "../util.js";

let mode = "list";
const CAT_EMOJI = { 고기: "🥩", 곱창: "🔥", 이자카야: "🍶", 해산물: "🦐", 일식: "🍣",
  중식: "🥟", 양식: "🍝", 한식: "🍚", 기타: "🍽" };
const withTimeout = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);

export const fullCond = (ctx, cond = ctx.cond) => ({ s: "any", n: null, b: "any", at: ctx.defaultAt(), c: "", w: [], x: [], ...cond });

/* 후보 계산. 룰렛 화면도 같은 결과를 쓴다 */
export async function computePicks(ctx, c) {
  const base = await ctx.base(c.at);
  await ctx.load(base);
  const mapsOk = await withTimeout(ctx.mapsOk, 7000, false);
  const near = (mapsOk ? await withTimeout(nearby(base), 8000, []) : []).filter(p => !ctx.closed.has(p.kakaoId));
  const sit = situationOf(c.s);
  return { base, sit, mapsOk, ...buildPicks(ctx.places, near, c, sit, CONFIG, base) };
}

export async function render(root, ctx, alive) {
  const c = fullCond(ctx);
  root.innerHTML = `<div class="wrap"><div class="empty"><b>후보를 모으는 중…</b>사내 별점과 주변 가게를 찾고 있어요</div></div>`;
  const r = await computePicks(ctx, c);
  if (!alive()) return;
  const { base, sit, list, wheel, mapsOk, cats, cat, total } = r;
  const good = list.filter(p => !p.isNew && !p.low), fresh = list.filter(p => p.isNew), low = list.filter(p => p.low);
  const summary = [c.n ? `${c.n}명` : "인원 무관", budgetOf(c.b).key === "any" ? "예산 무관" : budgetOf(c.b).label, base.key === "me" ? "내 위치" : base.name].join(" · ");
  const wide = matchMedia("(min-width: 900px)").matches;

  const section = (label, items) => items.length ? `${label ? `<p class="section-label">${label}</p>` : ""}${items.map(p => cardHtml(p, { removable: true, catBudget: ctx.catBudget })).join("")}` : "";
  const listHtml = list.length
    ? `<div class="plist">${section("", good)}${section("🆕 아직 평가 없는 근처 가게", fresh)}${section("평이 낮은 곳 · 룰렛에서 빠져요", low)}</div>`
    : `<div class="empty"><b>근처에 후보가 없어요</b>${!ctx.dataOk && !mapsOk ? "데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요." : "기준 위치나 조건을 바꿔보세요."}</div>`;

  root.innerHTML = `<div class="wrap">
    <button class="sitpill" id="chg">${sit.emoji} ${sit.label} · ${summary} <span style="opacity:.6">· 바꾸기</span></button>
    ${cats.length > 1 ? `<div class="mapfilters" id="cats">
      <button class="chip sm" data-c="" aria-pressed="${!cat}">전체 ${total}</button>
      ${cats.map(x => `<button class="chip sm" data-c="${x.cat}" aria-pressed="${cat === x.cat}">${CAT_EMOJI[x.cat] || "🍽"} ${x.cat} ${x.n}</button>`).join("")}
    </div>` : ""}
    <div class="phead"><h2>후보 ${list.length}곳 <span class="note" style="display:inline">${c.x.length ? `(${c.x.length}곳 뺌)` : ""}</span></h2>
      ${wide ? "" : `<div class="seg" id="seg"><button data-m="list" aria-pressed="${mode === "list"}">목록</button><button data-m="map" aria-pressed="${mode === "map"}">지도</button></div>`}</div>
    <div class="${wide ? "picks-split" : ""}">
      <div id="listBox" ${!wide && mode === "map" ? "hidden" : ""}>${listHtml}</div>
      <div class="mapbox" id="mapBox" ${!wide && mode === "list" ? "hidden" : ""}><div class="msg">${mapsOk ? "" : "지도를 불러오지 못했어요.<br>목록과 룰렛은 그대로 쓸 수 있어요."}</div></div>
    </div>
  </div>
  <div class="dock"><div class="wrap">
    ${wheel.length >= 2
      ? `<button class="btn primary" id="spin">🎡 룰렛 돌리기 <span style="opacity:.75;font-weight:700">${wheel.length}곳</span></button>`
      : `<button class="btn primary" id="widen">조건 넓히기</button>`}
    <button class="btn ghost" id="room" ${wheel.length >= 2 ? "" : "disabled"}>🗳 투표방</button>
  </div></div>`;

  const q = s => root.querySelector(s);
  q("#chg").onclick = () => ctx.go("setup", c);
  const catBox = q("#cats");
  if (catBox) catBox.onclick = e => {
    const b = e.target.closest("[data-c]");
    if (b) ctx.go("picks", { ...c, c: b.dataset.c });
  };
  if (q("#spin")) q("#spin").onclick = () => ctx.go("spin", c);
  if (q("#widen")) q("#widen").onclick = () => ctx.go("setup", c);
  if (q("#room")) q("#room").onclick = async e => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = "방 만드는 중";
    /* 후보를 그대로 박아 보낸다. 조건만 넘기면 여는 사람마다 다른 목록이 된다 */
    const res = await auth.room("", {
      /* 기준 위치는 방 화면이 따로 보여준다. 제목에 넣으면 겹친다 */
      title: [`${sit.emoji} ${sit.label}`, c.n ? `${c.n}명` : "", budgetOf(c.b).key === "any" ? "" : budgetOf(c.b).label].filter(Boolean).join(" · "),
      base: { name: base.key === "me" ? "내 위치" : base.name, lat: base.lat, lng: base.lng },
      picks: wheel.map(p => ({ kakaoId: p.kakaoId, name: unesc(p.name), cat: unesc(p.cat),
        score: p.rated ? p.score : 0, budget: p.budget || 0, dist: Math.round(p.dist || 0) }))
    });
    if (!res.ok) { b.disabled = false; b.textContent = "🗳 투표방"; return toast("방을 만들지 못했어요."); }
    ctx.go("room", { r: res.id });
  };
  q("#listBox").addEventListener("click", e => {
    const x = e.target.closest("[data-x]");
    if (x) { e.stopPropagation(); return ctx.go("picks", { ...c, x: [...c.x, x.dataset.x] }); }
    const card = e.target.closest(".pc");
    if (card) ctx.openSheet(list.find(p => p.id === card.dataset.id));
  });

  let map = null;
  const drawMap = () => {
    if (!mapsOk || map) return;
    const box = q("#mapBox"); box.innerHTML = "";
    map = makeMap(box, base);
    const pins = list.map(p => ({ lat: p.lat, lng: p.lng, el: pinEl(p, () => ctx.openSheet(p)) }));
    pins.push({ lat: base.lat, lng: base.lng, el: baseEl(base) });
    setPins(map, pins, { fit: true });
  };
  if (wide || mode === "map") drawMap();
  const seg = q("#seg");
  if (seg) seg.onclick = e => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    mode = b.dataset.m;
    seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    q("#listBox").hidden = mode !== "list"; q("#mapBox").hidden = mode !== "map";
    if (mode === "map") { drawMap(); map && map.relayout(); }
  };
}
