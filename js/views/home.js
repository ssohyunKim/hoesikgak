/* ① 어떤 회식? — 다음 날 카드 + 시간대별 상황 버튼 */
import { SITUATIONS, presetCond } from "../situations.js";
import { mealFor } from "../theme.js";
import { reviewDue, lastSpin, forgetSpin, myRatings, rateFormHtml, bindRateForm, submitRating, canRate } from "../rating.js";
import { shareSite, toast } from "../share.js";

const TITLES = {
  lunch: ["점심 회식,", "<em>어디로</em> 갈까요?"],
  dinner: ["오늘 밤,", "<em>어떤 자리</em>야?"],
};

export function render(root, ctx) {
  const meal = ctx.meal || mealFor(new Date());
  const due = canRate() ? reviewDue(Date.now(), lastSpin(), new Set(Object.keys(myRatings()))) : null;
  const sits = SITUATIONS.filter(s => s.time === meal);
  const any = SITUATIONS.find(s => s.time === "any");
  const [t1, t2] = TITLES[meal];

  root.innerHTML = `<div class="wrap">
    ${due ? `<section class="card due" id="due">
      <small>지난번 룰렛 결과</small>
      <h3>${due.name}, 어땠어요?</h3>
      ${rateFormHtml(due, { compact: true })}
      <button class="link skip" id="skip">안 갔어요</button>
    </section>` : ""}
    <h1 class="q">${t1}<br>${t2}</h1>
    <p class="sub">상황을 고르면 인원·예산이 알아서 채워지고, 마지막엔 룰렛이 정해요.</p>
    <div class="sits">
      ${sits.map(s => btn(s)).join("")}
      ${btn(any, sits.length % 2 === 0)}
    </div>
    <p class="mealsw"><button class="link" id="mealSw">${meal === "lunch" ? "🌙 저녁 회식 상황 보기" : "☀️ 점심 회식 상황 보기"}</button></p>
    <p class="mealsw"><button class="link" id="shareSite">회식각 공유하기</button></p>
  </div>`;

  root.querySelectorAll("[data-sit]").forEach(b => b.onclick = () =>
    ctx.go("setup", presetCond(b.dataset.sit, { at: ctx.defaultAt() })));
  root.querySelector("#mealSw").onclick = () => { ctx.meal = meal === "lunch" ? "dinner" : "lunch"; render(root, ctx); };
  root.querySelector("#shareSite").onclick = shareSite;

  if (due) {
    const box = root.querySelector("#due");
    root.querySelector("#skip").onclick = () => { forgetSpin(); box.remove(); };
    bindRateForm(box, due, async st => {
      await submitRating(due, st, "");
      ctx.refresh();
      toast(st.score <= 1 ? "비추로 남겼어요. 다음 사람이 안 데이게." : "고마워요! 다음 사람 결정에 바로 반영돼요.");
      box.remove();
    });
  }
}

function btn(s, wide = false) {
  return `<button class="sit${wide ? " wide" : ""}" data-sit="${s.key}">
    <span class="e" aria-hidden="true">${s.emoji}</span>
    <div><b>${s.label}</b><br><span>${s.desc}</span></div>
  </button>`;
}
