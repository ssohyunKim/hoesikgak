/* 화면과 마법사 상태를 주소 해시에 담는다. #/picks?s=team&n=8&b=3050&at=my&c=고기&w=room&x=1,2
   새로고침해도 그대로고, 링크를 보내면 같은 후보가 열린다 */
export const VIEWS = ["home", "setup", "picks", "spin", "map", "mypage", "room"];
const ORDER = ["s", "n", "b", "at", "c", "r", "w", "x"];
const LISTS = ["w", "x"];

export function buildHash(view, cond = {}) {
  if (view === "home" || !VIEWS.includes(view)) return "#/";
  const parts = [];
  for (const k of ORDER) {
    const v = cond[k];
    if (v === null || v === undefined || v === "") continue;
    if (LISTS.includes(k)) { if (v.length) parts.push(`${k}=${v.map(encodeURIComponent).join(",")}`); }
    else parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return `#/${view}${parts.length ? "?" + parts.join("&") : ""}`;
}

export function parseHash(hash) {
  const m = String(hash || "").match(/^#\/([a-z]*)(?:\?(.*))?$/);
  const view = m && VIEWS.includes(m[1]) ? m[1] : "home";
  const cond = {};
  if (!m || !m[2]) return { view, cond };
  for (const pair of m[2].split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = pair.slice(0, i), raw = pair.slice(i + 1);
    if (!ORDER.includes(k)) continue;
    if (LISTS.includes(k)) cond[k] = raw.split(",").filter(Boolean).map(decodeURIComponent);
    else if (k === "n") { const n = parseInt(raw, 10); if (n > 0) cond.n = n; }
    else cond[k] = decodeURIComponent(raw);
  }
  return { view, cond };
}
