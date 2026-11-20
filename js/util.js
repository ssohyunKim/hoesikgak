/* 시트·카카오에서 온 글자는 innerHTML 에 넣기 전에 반드시 esc 를 거친다 */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const UNESC = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ESC[c]);
export const unesc = v => String(v ?? "").replace(/&(amp|lt|gt|quot|#39);/g, (_, k) => UNESC[k]);

export const T = v => String(v ?? "").trim();

export function distOf(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, dla = (lat2 - lat1) * r, dlo = (lng2 - lng1) * r;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dlo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
export const fmtDist = d => d < 1000 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`;
export const won = n => (n || 0).toLocaleString("ko-KR");
export const man = n => `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만`;

/* DOM 헬퍼. 브라우저에서만 쓴다 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
