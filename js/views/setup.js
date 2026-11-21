/* ② 조건 — 상황 프리셋으로 미리 채워진 인원·예산·기준 위치·있으면 좋은 조건 */
import { BUDGETS, WANTS, situationOf } from "../situations.js";

export function render(root, ctx) {
  const c = { s: "any", n: null, b: "any", at: ctx.defaultAt(), w: [], x: [], ...ctx.cond };
  const sit = situationOf(c.s);
  const draw = () => {
    root.innerHTML = `<div class="wrap">
      <button class="sitpill" id="chSit">${sit.emoji} ${sit.label} <span style="opacity:.6">· 바꾸기</span></button>
      <h1 class="q">몇 명이서,<br><em>얼마</em>로?</h1>
      <p class="sub">상황에 맞게 채워뒀어요. 필요하면 바꾸세요.</p>

      <div class="field"><label>인원</label>
        <div class="stepper">
          <button type="button" id="minus" aria-label="인원 줄이기">−</button>
          <output id="n" class="${c.n ? "" : "any"}">${c.n ? c.n + "명" : "상관없음"}</output>
          <button type="button" id="plus" aria-label="인원 늘리기">+</button>
        </div></div>

      <div class="field"><label>인당 예산 <span class="note" style="display:inline">술 포함</span></label>
        <div class="chips" id="budgets">${BUDGETS.map(b =>
          `<button type="button" class="chip" data-b="${b.key}" aria-pressed="${c.b === b.key}">${b.label}</button>`).join("")}</div></div>

      <div class="field"><label>어디 근처?</label>
        <div class="chips" id="bases">${ctx.bases().map(o =>
          `<button type="button" class="chip" data-at="${o.key}" aria-pressed="${c.at === o.key}">${o.name}</button>`).join("")}
          <button type="button" class="chip" data-at="edit">✏️ 기준 바꾸기</button></div></div>

      <div class="field"><label>있으면 좋은 것 <span class="note" style="display:inline">없는 곳도 아래쪽에 남아요</span></label>
        <div class="chips" id="wants">${WANTS.map(w =>
          `<button type="button" class="chip" data-w="${w.key}" aria-pressed="${c.w.includes(w.key)}">${w.label}</button>`).join("")}</div></div>
    </div>
    <div class="dock"><div class="wrap"><button class="btn primary block" id="next">후보 보기 →</button></div></div>`;

    const $ = s => root.querySelector(s);
    $("#chSit").onclick = () => ctx.go("home", {});
    $("#minus").onclick = () => { c.n = !c.n || c.n <= 1 ? null : c.n - 1; draw(); };
    $("#plus").onclick = () => { c.n = c.n ? Math.min(60, c.n + 1) : 2; draw(); };
    $("#budgets").onclick = e => { const b = e.target.closest("[data-b]"); if (b) { c.b = b.dataset.b; draw(); } };
    $("#bases").onclick = e => {
      const b = e.target.closest("[data-at]"); if (!b) return;
      if (b.dataset.at === "edit") return ctx.editPlace();
      c.at = b.dataset.at; draw();
    };
    $("#wants").onclick = e => {
      const b = e.target.closest("[data-w]"); if (!b) return;
      const k = b.dataset.w; c.w = c.w.includes(k) ? c.w.filter(x => x !== k) : [...c.w, k]; draw();
    };
    $("#next").onclick = () => ctx.go("picks", { ...c, x: [] });
    ctx.replace("setup", c);      // 바꾼 값이 새로고침·뒤로 가기에도 남게
  };
  draw();
}
