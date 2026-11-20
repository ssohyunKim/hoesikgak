/* ═══════════════════════════════════════════════════
   후보 만들기
   1. 기준 위치 반경 안, 비추·뺀 곳 제외
   2. 평가된 곳을 점수순으로
   3. 평균 ROULETTE_MIN 이상이 MIN_GOOD 곳보다 적으면, 평가 없는 곳(🆕)을 가까운 순으로 MIN_PICKS 까지
   4. 평균이 낮은 곳은 목록 끝에만 두고 룰렛에서 뺀다
   ═══════════════════════════════════════════════════ */
import { score } from "./situations.js";
import { distOf } from "./util.js";

export function buildPicks(rated, nearby, cond, sit, cfg, base) {
  const excluded = new Set(cond.x || []);
  const out = id => excluded.has(id);
  const withDist = p => ({ ...p, dist: p.lat && p.lng ? distOf(base.lat, base.lng, p.lat, p.lng) : null });
  const inRange = p => p.dist === null ? (p.lat == null && base.key !== "me" && p.office === base.key) : p.dist <= cfg.NEAR_RADIUS;

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
  const list = good.concat(fill, low);
  return { list, wheel: list.filter(p => !p.low).slice(0, cfg.WHEEL_MAX) };
}
