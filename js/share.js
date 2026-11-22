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
const img = f => SITE.replace(/\/?$/, "/") + f;
const OG = img("og.png");   /* 사이트 공유·링크 미리보기. 메타태그라 한 장뿐이다 */
/* 결과 공유는 보낼 때 자바스크립트가 고르므로 지금 보고 있는 테마에 맞춘다.
   손으로 테마를 바꿔둔 사람도 자기가 본 화면과 같은 카드를 보내게 된다 */
const resultImg = () => img(document.documentElement.dataset.theme === "day"
  ? "share-result-day.png" : "share-result-night.png");
const cut = (s, n = 180) => s.length > n ? s.slice(0, n - 1) + "…" : s;

let toastT = null;
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2800);
}

/* SDK 받기 + init. 공유와 로그인(auth.js)이 같이 쓴다. 처음 부를 때 한 번만 받는다 */
let sdk = null;
export function kakaoSdk() {
  if (sdk) return sdk;
  sdk = new Promise(resolve => {
    if (!CONFIG.KAKAO_KEY) return resolve(false);
    const s = document.createElement("script");
    s.integrity = SDK.integrity; s.crossOrigin = "anonymous"; s.src = SDK.src;   // integrity 는 src 보다 먼저
    s.onload = () => {
      try { if (!Kakao.isInitialized()) Kakao.init(CONFIG.KAKAO_KEY); resolve(true); }
      catch { resolve(false); }
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return sdk;
}
async function withKakao() {
  if (!CONFIG.KAKAO_SHARE) return false;
  return (await kakaoSdk()) && !!(window.Kakao && Kakao.Share && Kakao.Share.sendDefault);
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

/* 회식각 안의 그 가게로 바로 여는 주소. 받은 사람이 평가·위치를 다 볼 수 있다 */
export const placeUrl = kakaoId => SITE.replace(/\/?$/, "/") + "#/place?k=" + encodeURIComponent(kakaoId);

/* ── 룰렛 결과를 "그림"으로 보내기 ────────────
   1) OS 공유 시트에 파일을 얹는다 — 카톡 대화방에 사진 그대로 들어간다
   2) 안 되면 카카오 서버에 올려 카드 이미지로 쓴다 (5MB·100일 보관)
   3) 둘 다 안 되면 평소 공유로 떨어진다
   file 은 roulette.js 가 캔버스로 그린 결과 이미지 */
export async function shareResultImage(file, p, { headline = "" } = {}) {
  const title = unesc(p.name);
  const text = [headline, title].filter(Boolean).join("\n");
  const url = p.kakaoId ? placeUrl(p.kakaoId) : SITE;
  const canFiles = () => !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const sendFiles = async () => {
    try { await navigator.share({ files: [file], text: `${text}\n${url}` }); return "files"; }
    catch (e) { return e && e.name === "AbortError" ? "cancel" : null; }
  };

  /* 폰에서는 공유 시트에 카카오톡이 있어서 사진이 대화방에 그대로 들어간다.
     PC 는 공유 시트에 카카오톡이 없을 수 있어 카드(이미지+링크)가 더 낫다 */
  const phone = matchMedia("(pointer: coarse)").matches;
  if (phone && canFiles()) {
    const r = await sendFiles();
    if (r) return r;
  }
  if (file && await withKakao()) {
    try {
      const dt = new DataTransfer(); dt.items.add(file);      /* uploadImage 는 FileList 를 받는다 */
      const up = await Kakao.Share.uploadImage({ file: dt.files });
      const img = up && up.infos && up.infos.original;
      if (img && img.url) {
        Kakao.Share.sendDefault({ objectType: "feed",
          content: { title, description: headline || "룰렛이 정했어요",
            imageUrl: img.url, imageWidth: img.width, imageHeight: img.height, link: link(url) },
          buttons: [{ title: "회식각에서 보기", link: link(url) }] });
        return "kakao";
      }
    } catch (e) { console.warn("룰렛 이미지 공유 실패:", e); }
  }
  /* 카카오가 막힌 PC 라면 그제야 공유 시트를 써본다 */
  if (!phone && canFiles()) {
    const r = await sendFiles();
    if (r) return r;
  }
  sharePlace(p, { headline, back: url });
  return "fallback";
}

/* 결과 공유. 주소가 있으면 위치 템플릿(지도 말풍선), 없으면 글만 */
export function sharePlace(p, { headline = "", back = SITE } = {}) {
  const title = unesc(p.name);
  const desc = [headline, [unesc(p.cat), p.rated ? `★${p.score.toFixed(1)}` : "", p.budget ? `인당 ${won(p.budget)}원` : ""]
    .filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  const addr = unesc(p.addr || "");
  /* 카카오맵으로 보내면 회식각으로 돌아올 길이 없다. 우리 주소로 보낸다 */
  const url = p.kakaoId ? placeUrl(p.kakaoId) : back;
  send({
    text: [title, desc, addr].filter(Boolean).join("\n"), url,
    kakao: addr
      ? { objectType: "location", address: addr, addressTitle: title,
          content: { title, description: cut(desc, 100),
            imageUrl: resultImg(), imageWidth: 1600, imageHeight: 800, link: link(url) },
          buttons: [{ title: "회식각에서 보기", link: link(url) }] }
      : { objectType: "text", text: cut([title, desc].join("\n")), link: link(url), buttonTitle: "회식각에서 보기" }
  });
}
