/* 지도 핀과 후보 카드. 후보 화면과 지도 화면이 같이 쓴다 */
import { fmtDist, man } from "../util.js";

export function pinColor(p) {
  if (p.rec === false) return "var(--pin-bad)";
  if (!p.rated) return "var(--pin-new)";
  return p.score >= 4 ? "var(--pin-hi)" : p.score >= 3 ? "var(--pin-mid)" : "var(--pin-lo)";
}
export function pinEl(p, onClick) {
  const el = document.createElement("div");
  el.className = "pin";
  el.style.setProperty("--pin-c", pinColor(p));
  el.innerHTML = `<i>${p.rec === false ? "비추" : p.rated ? "★" + p.score.toFixed(1) : "NEW"}</i>${p.name}`;
  el.onclick = onClick;
  return el;
}
export function baseEl(base) {
  const el = document.createElement("div");
  el.className = "pin base";
  el.textContent = base.key === "me" ? "📍 내 위치" : base.name;
  return el;
}

export function cardHtml(p, { removable = false } = {}) {
  const meta = [
    p.rated ? `<span class="st">★ ${p.score.toFixed(1)}</span><span>${p.count}명</span>` : "",
    p.cat ? `<span>${p.cat}</span>` : "",
    p.dist != null ? `<span>${fmtDist(p.dist)}</span>` : "",
    p.budget ? `<span>인당 ${man(p.budget)}</span>` : "",
    p.room === true ? "<span>룸</span>" : "",
  ].join("");
  const first = (p.reviews || []).find(r => !r.bad) || (p.reviews || [])[0];
  return `<div class="pc${p.low ? " low" : ""}" data-id="${p.id}" role="button" tabindex="0">
    <div>
      <h3>${p.name}
        ${p.isNew ? `<span class="badge new">🆕 평가 없음</span>` : ""}
        ${p.verified ? `<span class="badge ver">쩝쩝박사 인증</span>` : ""}
        ${p.rec === false ? `<span class="badge bad">비추</span>` : p.recNo ? `<span class="badge bad">비추 ${p.recNo}</span>` : ""}
      </h3>
      <div class="meta">${meta}</div>
      ${first ? `<p class="rv">“${first.txt}”</p>` : ""}
    </div>
    ${removable ? `<button class="x" data-x="${p.kakaoId || p.id}" aria-label="${p.name} 빼기">✕</button>` : ""}
  </div>`;
}
