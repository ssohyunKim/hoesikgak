/* 로그인 화면 — CONFIG.REQUIRE_LOGIN 이고 아직 로그인 전이면 이 화면만 보인다 */
import { login, reason } from "../auth.js";
import { toast } from "../share.js";

export function render(root) {
  root.innerHTML = `<div class="wrap login">
    <h1 class="q">회식각은<br><em>로그인</em>하고 써요</h1>
    <p class="sub">누가 남긴 평가인지 알아야 중복·장난 평가를 거르고,
      기기를 바꿔도 내 평가를 그대로 들고 다닐 수 있어요.</p>
    <button class="btn primary block" id="kakaoLogin">카카오로 시작하기</button>
    <p class="note">프로필·이메일은 받지 않아요. 카카오 회원번호도 그대로 저장하지 않고
      암호화한 값만 작성자 표시에 써요. 카카오 설정에서 회식각 연결을 끊으면
      남긴 평가도 함께 지워집니다.</p>
  </div>`;

  const b = root.querySelector("#kakaoLogin");
  b.onclick = async () => {
    b.disabled = true; b.textContent = "카카오로 이동 중";
    try { await login(); }                       /* 성공하면 페이지가 카카오로 넘어간다 */
    catch (e) {
      b.disabled = false; b.textContent = "카카오로 시작하기";
      toast(reason(e && e.message === "no_api" ? "no_api" : "no_sdk"));
    }
  };
}
