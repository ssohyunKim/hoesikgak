/* 기준 위치 등록·수정 — 로그인 직후 한 번, 나중엔 기준 칩의 "기준 바꾸기"로 */
import { pickAddress, geocode, save, here, myPlace } from "../place.js";
import { toast } from "../share.js";
import { esc } from "../util.js";

export function render(root, ctx) {
  const now = myPlace();
  const first = !now;
  let picked = null;                 // {name, addr, lat, lng}

  root.innerHTML = `<div class="wrap login">
    <h1 class="q">${first ? "회사가<br><em>어디</em>예요?" : "기준 위치<br><em>바꾸기</em>"}</h1>
    <p class="sub">여기를 기준으로 걸어갈 만한 회식 장소를 찾아요.
      주소나 건물 이름으로 찾을 수 있어요.</p>
    ${now ? `<p class="note" style="margin-bottom:12px">지금: <b>${esc(now.name)}</b>${now.addr ? " · " + esc(now.addr) : ""}</p>` : ""}

    <button class="btn primary block" id="search">🔍 주소 검색</button>
    <div class="pcbox" id="pcbox" hidden></div>

    <div id="confirm" hidden>
      <div class="field">
        <label>이 자리로 할까요?</label>
        <p class="picked" id="pickedAddr"></p>
      </div>
      <div class="field">
        <label for="nm">뭐라고 부를까요?</label>
        <input id="nm" type="text" maxlength="30" placeholder="예) 우리 회사" autocomplete="off">
      </div>
      <button class="btn primary block" id="saveBtn">여기로 정하기</button>
    </div>

    <button class="btn ghost block" id="here" style="margin-top:12px">📍 지금 있는 자리로 지정</button>
    ${first ? "" : `<p class="mealsw" style="margin-top:14px"><button class="link" id="back">그만두기</button></p>`}
  </div>`;

  const $ = s => root.querySelector(s);
  const box = $("#pcbox"), confirm = $("#confirm");

  const commit = async p => {
    try {
      await save(p);
      toast(`기준을 ${p.name}(으)로 잡았어요.`);
      ctx.afterPlace();
    } catch (e) {
      toast(e.message === "login" ? "로그인이 풀렸어요. 다시 로그인해 주세요."
        : "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
  };

  /* 주소를 고르면 좌표로 바꿔서 확인 단계를 보여준다 */
  const onPicked = async ({ addr, name }) => {
    box.hidden = true; box.innerHTML = "";
    const xy = await geocode(addr);
    if (!xy) { toast("그 주소의 좌표를 못 찾았어요. 다른 주소로 해보세요."); return; }
    picked = { name: name || addr, addr, ...xy };
    $("#pickedAddr").textContent = addr + (name ? ` (${name})` : "");
    $("#nm").value = picked.name;
    confirm.hidden = false;
    $("#nm").focus();
  };

  $("#search").onclick = async () => {
    confirm.hidden = true;
    box.hidden = false; box.innerHTML = "";
    try { onPicked(await pickAddress(box)); }
    catch { box.hidden = true; toast("주소 검색을 열지 못했어요. 잠시 뒤 다시 시도해 주세요."); }
  };
  $("#saveBtn").onclick = () => {
    if (!picked) return;
    const nm = $("#nm").value.trim();
    commit({ ...picked, name: nm || picked.addr });
  };
  $("#here").onclick = async () => {
    try { commit(await here()); }
    catch { toast("위치를 못 찾았어요. 주소로 검색해 주세요."); }
  };
  if (!first) $("#back").onclick = () => ctx.afterPlace();
}
