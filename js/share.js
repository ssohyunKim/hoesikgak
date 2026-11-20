/* ═══════════════════════════════════════════════════
   공유 — 카카오톡 카드 → OS 공유 시트 → 링크 복사 순으로 시도
   카카오 SDK 는 콘솔에 등록된 https 도메인에서만 동작한다. 처음 누를 때만 받는다
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import { unesc, won } from "./util.js";

const SDK = { src: "https://t1.kakaocdn.net/kakao_js_sdk/2.8.0/kakao.min.js",
  integrity: "sha384-Lvrr4dmJLLhBimcAC4GfpNV3oEGKgfd26Mp7KkvDz8PxGrhUhUT3zoax7EirW8fu" };
const SITE = CONFIG.SITE_URL;
const link = (url = SITE) => ({ mobileWebUrl: url, webUrl: url });
const OG = SITE.replace(/\/?$/, "/") + "og.png";
const cut = (s, n = 180) => s.length > n ? s.slice(0, n - 1) + "…" : s;

let toastT = null;
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2800);
}

let sdk = null;
function withKakao() {
  if (sdk) return sdk;
  sdk = new Promise(resolve => {
    if (!CONFIG.KAKAO_KEY || !CONFIG.KAKAO_SHARE) return resolve(false);
    const s = document.createElement("script");
    s.integrity = SDK.integrity; s.crossOrigin = "anonymous"; s.src = SDK.src;   // integrity 는 src 보다 먼저
    s.onload = () => {
      try { if (!Kakao.isInitialized()) Kakao.init(CONFIG.KAKAO_KEY); resolve(!!(Kakao.Share && Kakao.Share.sendDefault)); }
      catch { resolve(false); }
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return sdk;
}

export function copyLink(url) {
  const ok = () => toast("링크를 복사했어요. 단톡방에 붙여넣으면 돼요.");
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(ok, () => prompt("이 주소를 복사해주세요", url));
  else prompt("이 주소를 복사해주세요", url);
}

async function send({ text, url, kakao }) {
  if (await withKakao()) {
    try { Kakao.Share.sendDefault(kakao); return; } catch (e) { console.warn("카카오 공유 실패:", e); }
  }
  if (navigator.share) return navigator.share({ text: cut(text), url }).catch(() => {});
  copyLink(url);
}

export function shareSite() {
  send({
    text: "회식각 — 오늘도 못 정했지?\n상황만 고르면 룰렛이 정해준다.", url: SITE,
    kakao: { objectType: "feed",
      content: { title: "회식각 — 오늘도 못 정했지?", description: "상황만 고르면 룰렛이 정해준다.",
        imageUrl: OG, imageWidth: 1200, imageHeight: 630, link: link() },
      buttons: [{ title: "회식각 열어보기", link: link() }] }
  });
}

/* 결과 공유. 주소가 있으면 위치 템플릿(지도 말풍선), 없으면 글만. back 은 이 후보 화면 주소 */
export function sharePlace(p, { headline = "", back = SITE } = {}) {
  const title = unesc(p.name);
  const desc = [headline, [unesc(p.cat), p.rated ? `★${p.score.toFixed(1)}` : "", p.budget ? `인당 ${won(p.budget)}원` : ""]
    .filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  const addr = unesc(p.addr || "");
  const mapUrl = p.kakaoId ? `https://place.map.kakao.com/${p.kakaoId}` : SITE;
  send({
    text: [title, desc, addr].filter(Boolean).join("\n"), url: p.kakaoId ? mapUrl : back,
    kakao: addr
      ? { objectType: "location", address: addr, addressTitle: title,
          content: { title, description: cut(desc, 100), imageUrl: OG, link: link(back) },
          buttons: [{ title: "회식각에서 보기", link: link(back) }] }
      : { objectType: "text", text: cut([title, desc].join("\n")), link: link(back), buttonTitle: "회식각에서 보기" }
  });
}
