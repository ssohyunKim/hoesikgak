/* 마이페이지 — 내가 남긴 평가를 보고 고치거나 지운다.
   목록은 서버(D1)에서 받는다. 이 브라우저에 없던 평가도 보인다 */
import * as auth from "../auth.js";
import { rateFormHtml, bindRateForm, submitRating } from "../rating.js";
import { toast } from "../share.js";
import { esc, won } from "../util.js";
import { CLOSED_MARK } from "../data.js";

const fmtDate = t => {
  const d = new Date((t || 0) * 1000);
  return isNaN(d) || !t ? "" : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
};
const starLine = s => s === null || s === undefined ? "" : "★".repeat(s) + "☆".repeat(Math.max(0, 5 - s));

export async function render(root, ctx, alive = () => true) {
  root.innerHTML = `<div class="wrap"><div class="empty">내 평가를 불러오는 중…</div></div>`;
  const r = await auth.my();
  if (!alive || !alive()) return;

  if (!r.ok) {
    root.innerHTML = `<div class="wrap"><div class="empty">
      <b>${r.error === "login" ? "로그인이 풀렸어요" : "불러오지 못했어요"}</b>
      ${r.error === "login" ? "다시 로그인해 주세요." : "잠시 뒤 다시 열어주세요."}</div></div>`;
    if (r.error === "login") ctx.rerender();
    return;
  }

  const list = r.ratings || [];
  draw(root, ctx, list);
}

function draw(root, ctx, list) {
  const n = list.filter(x => !x.closed).length;
  root.innerHTML = `<div class="wrap">
    <h1 class="q">내가 남긴 <em>평가</em></h1>
    <p class="sub">${list.length
      ? `${n}곳에 별점을 남겼어요${list.length > n ? `, 폐업 신고 ${list.length - n}건` : ""}.`
      : "아직 남긴 평가가 없어요."}</p>
    ${list.length ? `<div class="mylist">${list.map(card).join("")}</div>` : `<div class="empty">
      <b>첫 평가를 남겨보세요</b>룰렛을 돌리고 다녀온 뒤에 물어볼게요.</div>`}
    <p class="mealsw" style="margin-top:18px"><button class="link" id="goHome">← 홈으로</button></p>
  </div>`;

  root.querySelector("#goHome").onclick = () => ctx.go("home", {});

  root.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openEdit(root, ctx, list, b.dataset.edit));
  root.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    const id = b.dataset.del, it = list.find(x => x.kakaoId === id);
    if (!window.confirm(`${it ? it.name : "이 가게"}에 남긴 평가를 지울까요?`)) return;
    b.disabled = true;
    const res = await auth.my(id);
    if (!res.ok) { b.disabled = false; return toast("지우지 못했어요. 잠시 뒤 다시 시도해 주세요."); }
    toast("지웠어요.");
    draw(root, ctx, list.filter(x => x.kakaoId !== id));
    ctx.reload();
  });
}

function card(x) {
  const badge = x.closed ? `<span class="badge bad">문 닫음 신고</span>`
    : x.score <= 1 ? `<span class="badge bad">비추</span>` : "";
  return `<article class="card myitem" id="my-${x.kakaoId}">
    <div class="myhead">
      <div>
        <h3>${esc(x.name)} ${badge}</h3>
        <p class="note">${esc(x.cat || "")}${x.addr ? " · " + esc(x.addr) : ""}</p>
      </div>
      <span class="mydate">${fmtDate(x.createdAt)}</span>
    </div>
    ${x.closed ? "" : `<p class="mystars">${starLine(x.score)} <b>${x.score}</b>${x.budget ? ` · 인당 ${won(x.budget)}원` : ""}</p>`}
    ${x.text ? `<p class="mytext">${esc(x.text)}</p>` : ""}
    <div class="myacts">
      <button class="btn ghost" data-edit="${x.kakaoId}">고치기</button>
      <button class="btn ghost" data-del="${x.kakaoId}">지우기</button>
    </div>
    <div class="myform" hidden></div>
  </article>`;
}

/* 기존 평가 폼을 그대로 쓴다. 서버에서 받은 값으로 미리 채운다 */
function openEdit(root, ctx, list, id) {
  const it = list.find(x => x.kakaoId === id);
  const box = root.querySelector(`#my-${CSS.escape(id)} .myform`);
  if (!it || !box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }

  const place = { kakaoId: it.kakaoId, name: it.name, cat: it.cat, kcat: "",
    addr: it.addr, lat: it.lat, lng: it.lng };
  const initial = { score: it.closed ? undefined : it.score, text: it.text || "",
    budget: it.budget ? String(it.budget) : undefined };

  box.hidden = false;
  box.innerHTML = rateFormHtml(place, { initial });
  bindRateForm(box, place, async st => {
    await submitRating(place, st, "");
    toast("고쳤어요. 다음 사람 결정에 바로 반영돼요.");
    const next = list.map(x => x.kakaoId === id
      ? { ...x, score: st.score, text: st.text || "", budget: +st.budget || x.budget, closed: 0,
          createdAt: Math.floor(Date.now() / 1000) }
      : x);
    draw(root, ctx, next);
    ctx.reload();
  }, initial);
}
