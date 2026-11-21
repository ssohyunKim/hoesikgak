/* 가게 한 곳 — 공유 링크(#/place?k=카카오ID)로 들어왔을 때.
   기준 위치와 무관하게 열려야 한다. 다른 지역 사람이 링크를 받아도 보여야 하니까 */
import { loadOne } from "../data.js";
import { esc } from "../util.js";

export async function render(root, ctx, alive = () => true) {
  const k = (ctx.cond.k || "").replace(/\D/g, "");
  if (!k) return ctx.go("home", {});

  root.innerHTML = `<div class="wrap"><div class="empty">가게를 불러오는 중…</div></div>`;
  /* 이미 읽어둔 주변 목록에 있으면 그걸 쓰고, 없으면 서버에서 한 곳만 가져온다 */
  const p = ctx.places.find(x => x.kakaoId === k) || await loadOne(k);
  if (!alive()) return;

  if (!p) {
    root.innerHTML = `<div class="wrap"><div class="empty">
      <b>아직 평가가 없는 곳이에요</b>회식각에 등록되지 않았거나 주소가 잘못됐어요.
      </div><p class="mealsw"><button class="link" id="home">← 회식각 둘러보기</button></p></div>`;
    root.querySelector("#home").onclick = () => ctx.go("home", {});
    return;
  }

  root.innerHTML = `<div class="wrap">
    <h1 class="q">${esc(p.name)}</h1>
    <p class="sub">${[esc(p.cat), p.rated ? `★ ${p.score.toFixed(1)} · ${p.count}명` : "아직 평가 없음"]
      .filter(Boolean).join(" · ")}</p>
    <p class="note">회식각에 올라온 평가예요. 가보셨다면 별점을 남겨주세요.</p>
    <p class="mealsw" style="margin-top:20px"><button class="link" id="home">← 회식각 둘러보기</button></p>
  </div>`;
  root.querySelector("#home").onclick = () => ctx.go("home", {});
  /* 상세 시트가 별점·예산·평가 폼을 전부 갖고 있어 그대로 연다 */
  ctx.openSheet(p);
}
