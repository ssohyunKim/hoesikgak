/* ═══════════════════════════════════════════════════
   별점 남기기 — 구글 폼으로 보내고, 반영될 때까지 이 브라우저에 들고 있는다.
   룰렛 결과를 기억해 두었다가 다음 방문 때 "어땠어요?"로 묻는다.
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import * as store from "./store.js";
import * as auth from "./auth.js";
import { esc, unesc } from "./util.js";
import { addPendingRow, CLOSED_MARK } from "./data.js";

const MINE_KEY = "hoesik.mine", SPIN_KEY = "hoesik.lastSpin", UID_KEY = "hoesik.uid";
const H = 3600e3;

/* ── 순수 함수 ─────────────────────────────── */
/* 미리 채운 링크(각 칸에 질문 이름)를 읽어 제출 주소와 칸 번호 짝을 만든다 */
export function parseFormLink(link) {
  if (!link) return null;
  try {
    const url = new URL(link), entries = {};
    url.searchParams.forEach((v, k) => { if (/^entry\.\d+$/.test(k)) entries[v.trim()] = k; });
    if (!entries["카카오ID"] || !entries["별점"]) return null;
    return { action: url.origin + url.pathname.replace(/\/(viewform|formResponse).*$/, "") + "/formResponse", entries };
  } catch { return null; }
}
export function formBody(form, vals) {
  const body = new URLSearchParams();
  for (const [name, entry] of Object.entries(form.entries)) if (name in vals) body.set(entry, String(vals[name] ?? ""));
  return body;
}
/* 룰렛 3시간 뒤부터 3일 안, 아직 평가 안 했으면 묻는다 */
export function reviewDue(now, last, mineIds) {
  if (!last || !last.place) return null;
  const age = now - last.t;
  if (age < 3 * H || age > 3 * 24 * H) return null;
  if (mineIds.has(last.place.kakaoId)) return null;
  return last.place;
}

/* ── 저장소 ───────────────────────────────── */
/* 로그인했으면 세션 uid, 아니면 이 브라우저에만 있는 익명 ID.
   익명 ID 는 기기를 바꾸면 달라져서 "내 평가"가 따라오지 않는다 */
export function uid() {
  const me = auth.uid();
  if (me) return me;
  let u = store.get(UID_KEY, "");
  if (!u) { u = "u" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); store.set(UID_KEY, u); }
  return u;
}
export const myRatings = () => store.get(MINE_KEY, {});
export const myRating = kid => myRatings()[kid] || null;
export function rememberSpin(place) {
  if (place && place.kakaoId) store.set(SPIN_KEY, { place, t: Date.now() });
}
export const lastSpin = () => store.get(SPIN_KEY, null);
export const forgetSpin = () => store.del(SPIN_KEY);

/* ── 보내기 ───────────────────────────────── */
const FORM = parseFormLink(CONFIG.RATE_FORM);
export const canRate = () => auth.enabled() || !!FORM;

/* Worker 를 거칠 때 쓰는 이름. 시트에 쓰는 Apps Script 가 이 이름들을 받는다.
   작성자는 보내지 않는다 — Worker 가 세션에서 꺼내 붙인다 */
const WORKER_KEYS = {
  "카카오ID": "kakaoId", "매장명": "name", "업종": "cat", "카카오분류": "kcat", "주소": "addr",
  "위도": "lat", "경도": "lng", "별점": "score", "인당예산": "budget", "룸": "room",
  "주차": "parking", "소음": "noise", "적정인원": "fit", "한줄평": "text",
  "기준": "base", "요청ID": "reqId"
};

/* st: {score, text, budget, fit, room, parking, noise}. 성공 여부를 알 수 없어서(no-cors)
   보내지면 성공으로 보고 화면에 바로 반영한다 */
export async function submitRating(p, st, base) {
  await send(p, st, base);
  const mine = myRatings(); mine[p.kakaoId] = { ...st }; store.set(MINE_KEY, mine);
  const last = lastSpin();
  if (last && last.place && last.place.kakaoId === p.kakaoId) forgetSpin();
}

/* "문 닫았어요" — 별점 없이 표시만 남긴다. 서로 다른 사람의 신고가 모이면 data.js 가 자동으로 숨긴다.
   같은 사람의 마지막 행만 세므로, 내 예전 별점은 이 신고로 바뀐다 */
const CLOSED_KEY = "hoesik.closed";
export const reportedClosed = kid => !!store.get(CLOSED_KEY, {})[kid];
export async function reportClosed(p, base) {
  await send(p, { score: "", text: CLOSED_MARK }, base);
  const m = store.get(CLOSED_KEY, {}); m[p.kakaoId] = Date.now(); store.set(CLOSED_KEY, m);
}

async function send(p, st, base) {
  const me = uid(), reqId = me + "-" + Date.now().toString(36);
  const vals = {
    "카카오ID": p.kakaoId, "매장명": unesc(p.name), "업종": unesc(p.cat), "카카오분류": unesc(p.kcat || ""),
    "주소": unesc(p.addr || ""), "위도": p.lat || "", "경도": p.lng || "", "별점": st.score,
    "인당예산": st.budget || "", "룸": st.room || "", "주차": st.parking || "", "소음": st.noise || "",
    "적정인원": st.fit || "", "한줄평": (st.text || "").slice(0, 300), "작성자": me, "기준": base || "", "요청ID": reqId
  };

  if (auth.enabled()) {
    /* 로그인 모드. 폼과 달리 성공·실패가 돌아온다 */
    const payload = {};
    for (const [k, v] of Object.entries(vals)) if (WORKER_KEYS[k]) payload[WORKER_KEYS[k]] = v;
    /* "문 닫았어요"는 별점 없이 표시만 남긴다. D1 에서는 따로 칸이 있다 */
    if (vals["한줄평"] === CLOSED_MARK) { payload.closed = 1; payload.text = ""; }
    const r = await auth.postRate(payload);
    if (!r.ok) throw new Error(r.error || "send_failed");
  } else {
    if (!FORM) throw new Error("no_form");
    await fetch(FORM.action, { method: "POST", mode: "no-cors", body: formBody(FORM, vals) });
  }
  addPendingRow({ ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, String(v)])), _t: Date.now() });
}

/* ── 입력 폼 ───────────────────────────────── */
const OPTS = {
  budget: ["인당 예산 (술 포함)", [["25000", "3만 이하"], ["40000", "3~5만"], ["70000", "5~10만"], ["120000", "10만 이상"]]],
  fit: ["적정 인원", [["4명 이하", "4명 이하"], ["5~8명", "5~8명"], ["9~12명", "9~12명"], ["13~20명", "13~20명"], ["20명 이상", "20명 이상"]]],
  room: ["룸", [["있음", "있음"], ["없음", "없음"]]],
  parking: ["주차", [["가능", "가능"], ["불가", "불가"]]],
  noise: ["소음", [["조용", "조용"], ["보통", "보통"], ["시끄러움", "시끄러움"]]],
};
/* initial 을 주면 그 값으로 채운다 (마이페이지는 서버에서 받은 내 평가를 쓴다) */
export function rateFormHtml(p, { compact = false, initial = null } = {}) {
  if (!p.kakaoId) return `<p class="note">지도에서 이 가게 위치를 찾는 중이에요. 잠시 뒤 다시 열어주세요.</p>`;
  const mine = initial || myRating(p.kakaoId) || {};
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="star" data-v="${n}" aria-pressed="${mine.score >= n}" aria-label="${n}점">★</button>`).join("");
  const row = k => {
    const [label, opts] = OPTS[k];
    return `<div class="rrow"><span>${label}</span><div class="chips">${
      opts.map(([v, t]) => `<button type="button" class="chip sm" data-k="${k}" data-v="${v}" aria-pressed="${String(mine[k]) === v}">${t}</button>`).join("")
    }</div></div>`;
  };
  /* 예산·룸·주차·소음은 조건 필터가 바로 쓰는 값이다. 지도 API 어디에도 없어서
     그 자리에 있었던 사람이 알려주지 않으면 영영 비어 있는다. 접어두지 않는다.
     (적정인원만 상세 화면에서 묻는다. 한 번 가본 걸로 가늠하기 어려운 값이라) */
  const PRIMARY = ["budget", "room", "parking", "noise"];
  return `<form class="rate" novalidate>
    <div class="stars" role="group" aria-label="별점">${stars}
      <button type="button" class="chip sm zero" data-v="0" aria-pressed="${mine.score === 0}">0점 · 별점도 아깝다</button></div>
    <p class="note">1점 이하는 비추 명단으로 가고 룰렛에서 빠져요.</p>
    ${PRIMARY.map(row).join("")}
    ${compact ? "" : row("fit")}
    <label class="flabel">코멘트 <em>선택</em>
      <textarea name="text" maxlength="300" rows="${compact ? 2 : 3}" placeholder="좋았던 점, 아쉬운 점, 예약 요령 뭐든. 안 써도 돼요.">${esc(mine.text || "")}</textarea></label>
    <button type="submit" class="btn primary block" disabled>${mine.score !== undefined ? "평가 고치기" : "남기기"}</button>
  </form>`;
}
/* onSubmit(st) 는 Promise. 끝나면 폼을 다시 그리는 건 호출한 쪽이 한다 */
export function bindRateForm(root, p, onSubmit, initial = null) {
  const form = root.querySelector("form.rate"); if (!form) return;
  const st = { ...(initial || myRating(p.kakaoId) || {}) };
  const send = form.querySelector("[type=submit]");
  const sync = () => { send.disabled = st.score === undefined; };
  form.addEventListener("click", e => {
    const s = e.target.closest(".star,.zero");
    if (s) {
      st.score = +s.dataset.v;
      form.querySelectorAll(".star").forEach(b => b.setAttribute("aria-pressed", String(st.score > 0 && +b.dataset.v <= st.score)));
      form.querySelector(".zero").setAttribute("aria-pressed", String(st.score === 0));
      return sync();
    }
    const c = e.target.closest(".chip[data-k]");
    if (c) {
      const k = c.dataset.k, on = st[k] === c.dataset.v;
      if (on) delete st[k]; else st[k] = c.dataset.v;
      form.querySelectorAll(`.chip[data-k="${k}"]`).forEach(b => b.setAttribute("aria-pressed", String(!on && b === c)));
    }
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (st.score === undefined) return;
    st.text = form.querySelector("textarea").value.trim();
    send.disabled = true; send.textContent = "보내는 중";
    try { await onSubmit({ ...st }); }
    catch { send.disabled = false; send.textContent = "다시 보내기"; }
  });
  sync();
}
