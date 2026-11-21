/* ═══════════════════════════════════════════════════
   후보 만들기
   1. 기준 위치 반경 안, 비추·뺀 곳 제외
   2. 평가된 곳을 점수순으로
   3. 평균 ROULETTE_MIN 이상이 MIN_GOOD 곳보다 적으면, 평가 없는 곳(🆕)을 가까운 순으로 MIN_PICKS 까지
   4. 평균이 낮은 곳은 목록 끝에만 두고 룰렛에서 뺀다
   5. cond.c 로 업종을 골랐으면 목록과 룰렛을 그 업종으로 좁힌다

   업종은 맨 마지막에만 거른다. 그 앞 단계에서 걸러버리면 🆕 채우기가 업종 하나로만 채워져
   "고기 3곳" 같은 개수가 실제와 달라진다.
   ═══════════════════════════════════════════════════ */
import { score } from "./situations.js";
import { distOf } from "./util.js";

export function buildPicks(rated, nearby, cond, sit, cfg, base) {
  const excluded = new Set(cond.x || []);
  const out = id => excluded.has(id);
  const withDist = p => ({ ...p, dist: p.lat && p.lng ? distOf(base.lat, base.lng, p.lat, p.lng) : null });
  /* 좌표가 없는 곳은 거리를 못 재니 후보에 못 올린다 */
  const inRange = p => p.dist !== null && p.dist <= cfg.NEAR_RADIUS;

  const known = rated.map(withDist).filter(inRange).filter(p => p.rec !== false && !out(p.kakaoId) && !out(p.id));
  /* 시트에 있는 가게는 비추든 뺐든 주변 검색에서 🆕 로 다시 들어오면 안 된다 */
  const seen = new Set(rated.map(p => p.kakaoId).filter(Boolean));

  const ranked = known.filter(p => p.rated)
    .map(p => ({ ...p, isNew: false, _s: score(p, cond, sit) }))
    .sort((a, b) => b._s - a._s);
  const good = ranked.filter(p => p.score >= cfg.ROULETTE_MIN);
  const low = ranked.filter(p => p.score < cfg.ROULETTE_MIN).map(p => ({ ...p, low: true }));

  let fill = [];
  if (good.length < cfg.MIN_GOOD) {
    const catOk = p => !sit.cats || sit.cats.includes(p.cat);
    const pool = known.filter(p => !p.rated)                      // 시트에 있지만 별점이 없는 곳
      .concat(nearby.map(withDist).filter(p => p.dist === null || p.dist <= cfg.NEAR_RADIUS)
        .filter(p => !seen.has(p.kakaoId) && !out(p.kakaoId)))
      .filter(catOk)
      .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    const ids = new Set();
    for (const p of pool) {
      if (good.length + fill.length >= cfg.MIN_PICKS) break;
      if (ids.has(p.id)) continue;
      ids.add(p.id);
      fill.push({ ...p, isNew: true });
    }
  }
  const all = good.concat(fill, low);

  /* 업종 칩에 쓸 개수. 고르기 전 전체 후보 기준이라 눌러도 0곳이 되지 않는다 */
  const counts = new Map();
  all.forEach(p => { const k = p.cat || "기타"; counts.set(k, (counts.get(k) || 0) + 1); });
  const order = sit.cats || [];
  const cats = [...counts.entries()].map(([cat, n]) => ({ cat, n }))
    .sort((a, b) => (order.includes(b.cat) - order.includes(a.cat)) || (b.n - a.n) || a.cat.localeCompare(b.cat));

  const pickedCat = cond.c && counts.has(cond.c) ? cond.c : "";
  const list = pickedCat ? all.filter(p => (p.cat || "기타") === pickedCat) : all;
  return { list, cats, cat: pickedCat, total: all.length,
    wheel: list.filter(p => !p.low).slice(0, cfg.WHEEL_MAX) };
}
