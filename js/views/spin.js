/* 🎡 룰렛 → 결과. 낮이든 밤이든 .night 무대 위에서 돌린다 */
import { drawWheel, spinWheel, resultImageFile } from "../roulette.js";
import { rememberSpin } from "../rating.js";
import { shareResultImage } from "../share.js";
import { fmtDist, man } from "../util.js";
import { buildHash } from "../router.js";
import { budgetOf } from "../situations.js";
import { computePicks, fullCond } from "./picks.js";

export async function render(root, ctx, alive) {
  const c = fullCond(ctx);
  root.innerHTML = `<div class="stage night"><div class="wrap"><div class="empty"><b>룰렛 준비 중…</b></div></div></div>`;
  const { wheel, sit, base } = await computePicks(ctx, c);
  if (!alive()) return;
  if (wheel.length < 2) return ctx.go("picks", c);

  const ctxLine = [`${sit.emoji} ${sit.label}`, c.n ? `${c.n}명` : "", budgetOf(c.b).key === "any" ? "" : budgetOf(c.b).label,
    base.key === "me" ? "내 위치" : base.name].filter(Boolean).join(" · ");
  root.innerHTML = `<div class="stage night" role="dialog" aria-label="회식 장소 룰렛">
    <button class="iconbtn back" id="back">← 후보</button>
    <div class="wrap">
      <div class="ctx">${ctxLine}</div>
      <div class="wheelbox"><div class="needle"></div><canvas id="wheel" width="720" height="720"></canvas></div>
      <button class="btn primary block" id="go">돌리기</button>
      <div id="out"></div>
    </div>
  </div>`;
  const q = s => root.querySelector(s);
  const canvas = q("#wheel");
  let rot = -Math.PI / 2, spinning = false;
  drawWheel(canvas, wheel, rot);
  q("#back").onclick = () => ctx.go("picks", c);

  const go = async () => {
    if (spinning) return;
    spinning = true; q("#go").disabled = true; q("#go").hidden = false; q("#out").innerHTML = "";
    const r = await spinWheel(canvas, wheel, rot);
    rot = r.rot; spinning = false;
    if (!alive()) return;
    const p = wheel[r.index];
    rememberSpin(p);
    q("#go").disabled = false; q("#go").hidden = true;   // 결과 카드의 "다시"로 돌린다
    const quote = (p.reviews || []).find(x => !x.bad);
    q("#out").innerHTML = `<div class="card result" style="margin-top:16px">
      <div class="ctx">오늘은 여기!</div>
      <div class="win">🏮 ${p.name}</div>
      <div class="meta">${[p.cat, p.rated ? `★${p.score.toFixed(1)} (${p.count}명)` : "", p.dist != null ? fmtDist(p.dist) : "",
        p.budget ? `인당 ${man(p.budget)}` : ""].filter(Boolean).join(" · ")}</div>
      ${p.isNew ? `<p class="quote">🆕 아직 평가 없는 곳이에요. 다녀와서 첫 평가의 주인공이 돼주세요!</p>` : ""}
      ${quote ? `<p class="quote">“${quote.txt}”</p>` : ""}
      <div class="grid">
        <button class="btn primary" id="share">💬 카톡으로 팀에 공유</button>
        ${p.phone ? `<a class="btn" href="tel:${p.phone}">📞 예약 전화</a>` : ""}
        <button class="btn${p.phone ? "" : " span2"}" id="detail">🗺 지도·상세</button>
        <button class="btn ghost" id="again">🔁 다시</button>
        <button class="btn ghost" id="without">✕ 여기 빼고 다시</button>
      </div></div>`;
    const back = location.origin + location.pathname + buildHash("picks", c);
    /* 돌아간 룰렛을 그림으로 떠서 같이 보낸다. 실패하면 share.js 가 평소 공유로 떨어뜨린다 */
    q("#share").onclick = async e => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = "준비 중…";
      let file = null;
      try { file = await resultImageFile(wheel, rot, p); } catch (err) { console.warn("결과 이미지 실패:", err); }
      await shareResultImage(file, p, { headline: ctxLine });
      b.disabled = false; b.textContent = "💬 카톡으로 팀에 공유";
    };
    q("#detail").onclick = () => ctx.openSheet(p);
    q("#again").onclick = go;
    q("#without").onclick = () => ctx.go("spin", { ...c, x: [...c.x, p.kakaoId || p.id] });
    q("#out").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  q("#go").onclick = go;
}
