/* 상세 시트 — 어느 화면에서든 가게를 누르면 아래에서(넓은 화면은 오른쪽에서) 올라온다 */
import { fmtDist, won, $ } from "../util.js";
import { rateFormHtml, bindRateForm, submitRating, canRate, myRating } from "../rating.js";
import { sharePlace, toast } from "../share.js";

const U = `<span class="unk">모름</span>`;
const yn = (v, y, n) => v === true ? y : v === false ? n : U;

export function open(p, ctx) {
  if (!p) return;
  const el = $("#sheet");
  const stars = n => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
  const mapHref = p.kakaoId ? `https://place.map.kakao.com/${p.kakaoId}` : `https://map.kakao.com/?q=${encodeURIComponent(p.name)}`;
  el.innerHTML = `<div class="wrap">
    <div class="grab"></div>
    <div class="hd"><h2>${p.name}</h2><button class="close" id="shClose" aria-label="닫기">✕</button></div>
    <p class="note" style="margin-top:4px">${[p.cat, p.dist != null ? fmtDist(p.dist) : ""].filter(Boolean).join(" · ")}</p>
    ${p.rec === false ? `<div class="warnbar">비추 명단에 있는 곳이에요. 룰렛에 안 올라가요.</div>`
      : p.recNo ? `<div class="warnbar">비추 표가 ${p.recNo}개 있어요. 후기를 먼저 읽어보세요.</div>` : ""}
    ${!p.rated ? `<div class="infobar">🆕 아직 아무도 평가 안 한 곳이에요. 가봤다면 첫 별점을 남겨주세요.</div>` : ""}

    ${p.rated ? `<div class="block-title">사내 별점</div>
      <div class="big-score"><b>${p.score.toFixed(1)}</b><span class="s">${stars(p.score)}</span><span class="note" style="margin:0">${p.count}명</span></div>` : ""}

    <div class="acts">
      <a class="btn" href="${mapHref}" target="_blank" rel="noopener">카카오맵</a>
      ${p.phone ? `<a class="btn" href="tel:${p.phone}">전화</a>` : ""}
      <button class="btn" id="shShare">위치 공유</button>
    </div>

    <dl class="facts">
      <dt>인당 예산</dt><dd>${p.budget ? won(p.budget) + "원 쯤" : U}</dd>
      <dt>적정 인원</dt><dd>${p.fit ? p.fit.label : U}</dd>
      <dt>룸</dt><dd>${yn(p.room, "있음", "없음")}</dd>
      <dt>주차</dt><dd>${yn(p.parking, "가능", "불가")}</dd>
      <dt>소음</dt><dd>${p.noise || U}</dd>
      ${p.addr ? `<dt>주소</dt><dd>${p.addr}</dd>` : ""}
    </dl>

    ${p.reviews && p.reviews.length ? `<div class="block-title">후기</div>
      ${p.reviews.slice(0, 8).map(r => `<div class="review${r.bad ? " bad" : ""}">${r.bad ? "아쉬운 점 · " : ""}${r.txt}</div>`).join("")}` : ""}

    ${canRate() ? `<div class="block-title" id="rateTitle">${myRating(p.kakaoId) ? "내 평가 고치기" : "가봤다면 별점 남기기"}</div>
      <div id="rateBox">${rateFormHtml(p)}</div>` : ""}
  </div>`;
  el.classList.add("on"); el.setAttribute("aria-hidden", "false"); el.scrollTop = 0;
  $("#scrim").classList.add("on");
  $("#shClose").onclick = close;
  $("#shShare").onclick = () => sharePlace(p, { back: location.href });
  const box = $("#rateBox");
  if (box) bindRateForm(box, p, async st => {
    await submitRating(p, st, ctx.cond.at || "");
    ctx.refresh();
    toast(st.score <= 1 ? "비추로 남겼어요. 다음 사람이 안 데이게." : "남겼어요. 고마워요!");
    await ctx.rerender();
    const updated = ctx.places.find(x => x.kakaoId === p.kakaoId);
    open(updated ? { ...updated, dist: p.dist } : p, ctx);
  });
}

export function close() {
  const el = $("#sheet");
  if (!el.classList.contains("on")) return;
  el.classList.remove("on"); el.setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("on");
}
