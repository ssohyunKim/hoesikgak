/* 🗳 투표방 — 후보는 만들 때 고정된다. 누가 열어도 같은 목록을 본다.
   1인 1표(다시 누르면 바뀜), 마감은 방장이 상위 3곳으로 룰렛을 돌려서 한다 */
import * as auth from "../auth.js";
import { drawWheel, spinWheel } from "../roulette.js";
import { toast, copyLink, sharePlace } from "../share.js";
import { esc, won, fmtDist } from "../util.js";
import { CONFIG } from "../config.js";

const TOP = 3;                     /* 마감 룰렛에 올리는 상위 개수 */
const POLL = 8000;                 /* 열어둔 동안 표를 다시 읽는 주기 */
let timer = null;

export const roomUrl = id => CONFIG.SITE_URL.replace(/\/?$/, "/") + "#/room?r=" + id;

export async function render(root, ctx, alive = () => true) {
  clearInterval(timer);
  const id = (ctx.cond.r || "").trim();
  if (!id) return ctx.go("home", {});

  root.innerHTML = `<div class="wrap"><div class="empty">투표방을 여는 중…</div></div>`;
  const r = await auth.room("/get", { id });
  if (!alive()) return;
  if (!r.ok) {
    root.innerHTML = `<div class="wrap"><div class="empty">
      <b>${r.error === "not_found" ? "없는 방이에요" : "열지 못했어요"}</b>
      ${r.error === "not_found" ? "주소가 맞는지 확인해 주세요." : "잠시 뒤 다시 시도해 주세요."}
      </div><p class="mealsw"><button class="link" id="home">← 홈으로</button></p></div>`;
    root.querySelector("#home").onclick = () => ctx.go("home", {});
    return;
  }

  draw(root, ctx, r.room, alive);
  /* 열어둔 동안 표가 늘어나는 걸 보여준다 */
  timer = setInterval(async () => {
    if (!alive() || document.hidden) return;
    const n = await auth.room("/get", { id });
    if (n.ok && alive() && !n.room.closed) draw(root, ctx, n.room, alive, true);
    else if (n.ok && n.room.closed) { clearInterval(timer); draw(root, ctx, n.room, alive); }
  }, POLL);
}

function draw(root, ctx, room, alive, quiet = false) {
  const total = room.voters || 0;
  const ranked = [...room.picks].sort((a, b) => (room.tally[b.kakaoId] || 0) - (room.tally[a.kakaoId] || 0));
  const win = room.winner && room.picks.find(p => p.kakaoId === room.winner);

  /* 투표 중에 화면이 통째로 다시 그려지면 누르던 자리가 튄다. 표 수만 갈아끼운다 */
  if (quiet && root.querySelector("#votes")) {
    root.querySelectorAll("[data-vote]").forEach(b => {
      const n = room.tally[b.dataset.vote] || 0;
      b.querySelector(".vn").textContent = n ? `${n}표` : "";
      b.setAttribute("aria-pressed", String(room.mine === b.dataset.vote));
      b.style.setProperty("--bar", total ? `${Math.round(n / total * 100)}%` : "0%");
    });
    root.querySelector("#cnt").textContent = `${total}명 참여`;
    return;
  }

  root.innerHTML = `<div class="wrap">
    <h1 class="q">🗳 ${win ? "여기로 정했어요" : "어디로 갈까요?"}</h1>
    <p class="sub">${esc(room.title || "")}${room.base && room.base.name ? ` · ${esc(room.base.name)} 주변` : ""}</p>

    ${win ? `<div class="card winner">
        <small>룰렛이 고른 곳</small><h3>${esc(win.name)}</h3>
        <p class="note">${esc(win.cat || "")}${win.budget ? ` · 인당 ${won(win.budget)}원` : ""}</p>
        <div class="myacts"><button class="btn primary" id="shareWin">💬 카톡으로 공유</button></div>
      </div>` : ""}

    <div class="votebar"><span id="cnt">${total}명 참여</span>
      <button class="link" id="copy">🔗 링크 복사</button></div>

    <div class="plist" id="votes">${ranked.map(p => {
      const n = room.tally[p.kakaoId] || 0;
      return `<button class="pc vote" data-vote="${p.kakaoId}"
        aria-pressed="${room.mine === p.kakaoId}"
        ${room.closed ? "disabled" : ""}
        style="--bar:${total ? Math.round(n / total * 100) : 0}%">
        <h3>${esc(p.name)}</h3>
        <p class="note">${esc(p.cat || "")}${p.score ? ` · ★${p.score.toFixed(1)}` : ""}${p.budget ? ` · 인당 ${won(p.budget)}원` : ""}${p.dist ? ` · ${fmtDist(p.dist)}` : ""}</p>
        <span class="vn">${n ? `${n}표` : ""}</span>
      </button>`;
    }).join("")}</div>

    ${room.closed ? `<p class="note" style="margin-top:14px">마감된 방이에요.</p>` : ""}
    <p class="mealsw" style="margin-top:18px"><button class="link" id="home">← 홈으로</button></p>
  </div>
  ${room.owner && !room.closed ? `<div class="dock"><div class="wrap">
    <button class="btn primary" id="finish" ${total ? "" : "disabled"}>🎡 상위 ${TOP}곳으로 룰렛</button>
  </div></div>` : ""}`;

  const q = s => root.querySelector(s);
  q("#home").onclick = () => ctx.go("home", {});
  q("#copy").onclick = () => copyLink(roomUrl(room.id));
  if (q("#shareWin")) q("#shareWin").onclick = () =>
    sharePlace({ ...win, rated: !!win.score, addr: "" }, { headline: "투표로 정했어요", back: roomUrl(room.id) });

  q("#votes").onclick = async e => {
    const b = e.target.closest("[data-vote]");
    if (!b || room.closed) return;
    const pick = b.dataset.vote;
    const res = await auth.room("/vote", { id: room.id, kakaoId: pick });
    if (!res.ok) return toast(res.error === "closed" ? "이미 마감된 방이에요." : "투표하지 못했어요.");
    const fresh = await auth.room("/get", { id: room.id });
    if (fresh.ok && alive()) draw(root, ctx, fresh.room, alive);
  };

  if (q("#finish")) q("#finish").onclick = () => finish(root, ctx, room, ranked, alive);
}

/* 상위 TOP 곳으로 룰렛. 돌고 나면 방을 마감하고 결과를 박아둔다 */
async function finish(root, ctx, room, ranked, alive) {
  const pool = ranked.filter(p => (room.tally[p.kakaoId] || 0) > 0).slice(0, TOP);
  if (!pool.length) return toast("아직 표가 없어요.");
  if (pool.length === 1) return close(root, ctx, room, pool[0], alive);

  clearInterval(timer);
  root.innerHTML = `<div class="wrap night">
    <h1 class="q">상위 ${pool.length}곳으로<br><em>돌립니다</em></h1>
    <div class="wheelbox"><div class="needle"></div><canvas id="wheel" width="720" height="720"></canvas></div>
  </div>`;
  const canvas = root.querySelector("#wheel");
  drawWheel(canvas, pool);
  const r = await spinWheel(canvas, pool);
  if (!alive()) return;
  close(root, ctx, room, pool[r.index], alive);
}

async function close(root, ctx, room, winner, alive) {
  const res = await auth.room("/close", { id: room.id, winner: winner.kakaoId });
  if (!res.ok) return toast("마감하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  const fresh = await auth.room("/get", { id: room.id });
  if (fresh.ok && alive()) draw(root, ctx, fresh.room, alive);
}

export function leave() { clearInterval(timer); }
