/* ═══════════════════════════════════════════════════
   상황 프리셋과 후보 점수

   상황은 걸러내지 않고 순위만 바꾼다 (정보가 빈 가게가 많아 걸러내면 후보가 0곳이 되기 쉽다).
   가중치를 손보려면 SITUATIONS 의 w(배수)와 cats(가산 업종)만 바꾸면 된다.
   ═══════════════════════════════════════════════════ */

export const BUDGETS = [
  { key: "any", lo: 0, hi: Infinity, label: "상관없음" },
  { key: "u15", lo: 0, hi: 15000, label: "1.5만 이하" },
  { key: "u30", lo: 0, hi: 30000, label: "3만 이하" },
  { key: "3050", lo: 30000, hi: 50000, label: "3~5만" },
  { key: "o30", lo: 30000, hi: Infinity, label: "3만 이상" },
  { key: "o50", lo: 50000, hi: Infinity, label: "5만 이상" },
];
export const budgetOf = key => BUDGETS.find(b => b.key === key) || BUDGETS[0];

export const WANTS = [
  { key: "room", label: "룸" },
  { key: "parking", label: "주차" },
  { key: "quiet", label: "조용한 곳" },
];

/* time: lunch | dinner | any. preset 은 ② 조건에 미리 채울 값 */
export const SITUATIONS = [
  { key: "quick", time: "lunch", emoji: "🍚", label: "빨리 먹고 들어오기", desc: "가깝고 빠르게",
    preset: { b: "u15" }, w: { dist: 3 } },
  { key: "newbie-lunch", time: "lunch", emoji: "🎉", label: "신입 환영 점심", desc: "평 좋은 단체석",
    preset: { n: 8, b: "u30" }, w: { rating: 1.5, fit: 1.5 } },
  { key: "vip-lunch", time: "lunch", emoji: "🤝", label: "손님·임원 점심", desc: "조용하고 룸 있는 곳",
    preset: { n: 4, b: "o30", w: ["quiet", "room"] } },
  { key: "cheap-lunch", time: "lunch", emoji: "💸", label: "가성비 점심", desc: "1.5만 이하",
    preset: { b: "u15" }, w: { budget: 2 } },
  { key: "team", time: "dinner", emoji: "🍻", label: "팀 회식", desc: "고기·곱창, 단체석",
    preset: { n: 8, b: "3050" }, cats: ["고기", "곱창"] },
  { key: "vip", time: "dinner", emoji: "🤫", label: "임원 있는 자리", desc: "룸, 조용함",
    preset: { n: 6, b: "o50", w: ["room", "quiet"] } },
  { key: "small", time: "dinner", emoji: "🍶", label: "소수 술자리", desc: "이자카야·해산물·술집",
    preset: { n: 3 }, cats: ["이자카야", "해산물", "기타"] },
  { key: "farewell", time: "dinner", emoji: "🥂", label: "환영·송별회", desc: "평 좋은 곳, 룸",
    preset: { n: 12, w: ["room"] }, w: { rating: 1.5 } },
  { key: "cheap", time: "dinner", emoji: "💸", label: "가성비 회식", desc: "3만 이하",
    preset: { b: "u30" }, w: { budget: 2 } },
  { key: "any", time: "any", emoji: "🎲", label: "아무 데나", desc: "그냥 섞어서", preset: {} },
];
export const situationOf = key => SITUATIONS.find(s => s.key === key) || SITUATIONS[SITUATIONS.length - 1];

export function presetCond(key, { at } = {}) {
  const s = situationOf(key), p = s.preset || {};
  return { s: s.key, n: p.n ?? null, b: p.b || "any", at, w: [...(p.w || [])], x: [] };
}

/* 평가 수를 감안한 평균. 1명의 5점보다 5명의 4.5점이 높다 */
export const bayes = p => (p.score * p.count + 3.5 * 2) / (p.count + 2);

export function score(p, cond, sit) {
  const w = { rating: 1, dist: 1, budget: 1, fit: 1, ...(sit.w || {}) };
  let s = bayes(p) * 10 * w.rating;
  s -= (p.dist || 0) / 150 * w.dist;

  const b = budgetOf(cond.b);
  if (b.key !== "any") {
    if (!p.budget) s -= 3 * w.budget;
    else if (p.budget < b.lo || p.budget > b.hi) s -= 20 * w.budget;
  }
  if (cond.n && p.fit) {
    if (cond.n >= p.fit.min && cond.n <= p.fit.max) s += 10 * w.fit;
    else s -= Math.min(15, Math.abs(cond.n - (cond.n < p.fit.min ? p.fit.min : p.fit.max)) * 2) * w.fit;
  }
  if (sit.cats && sit.cats.includes(p.cat)) s += 8;

  for (const k of cond.w || []) {
    if (k === "quiet") s += p.noise === "조용" ? 6 : p.noise === "시끄러움" ? -10 : 0;
    else if (k === "room" || k === "parking") s += p[k] === true ? 8 : p[k] === false ? -10 : 0;
  }
  if (p.verified) s += 3;
  s -= 5 * (p.recNo || 0);
  return s;
}
