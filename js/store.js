/* localStorage 래퍼. 시크릿 창·차단 환경에서 예외가 나도 화면이 멈추지 않게 한다 */
export function get(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
export function set(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
}
export function del(key) {
  try { localStorage.removeItem(key); } catch { /* 저장 불가 환경 */ }
}
