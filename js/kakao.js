/* ═══════════════════════════════════════════════════
   카카오 지도 SDK — 지도, 사옥 좌표, 주변 가게 검색, 옛 데이터 이름 찾기
   SDK 가 막혀도(도메인 미등록 등) 나머지 화면은 돌아가야 해서 모든 함수가 조용히 실패한다
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import { esc, distOf } from "./util.js";
import { catOf } from "./data.js";

let loading = null;
export const mapsReady = () => !!(window.kakao && window.kakao.maps && window.kakao.maps.services && window.kakao.maps.Map);

export function loadMaps() {
  if (loading) return loading;
  loading = new Promise(resolve => {
    if (!CONFIG.KAKAO_KEY) return resolve(false);
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.KAKAO_KEY}&libraries=services&autoload=false`;
    s.onload = () => { try { kakao.maps.load(() => resolve(true)); } catch { resolve(false); } };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return loading;
}

/* 사옥 주소를 좌표로. 못 찾으면 설정의 대략값을 그대로 쓴다 */
export async function geocodeOffices(offices) {
  if (!(await loadMaps())) return;
  const geo = new kakao.maps.services.Geocoder();
  await Promise.all(offices.map(o => new Promise(done => {
    geo.addressSearch(o.addr, (res, st) => {
      if (st === kakao.maps.services.Status.OK && res[0]) { o.lat = +res[0].y; o.lng = +res[0].x; }
      done();
    });
  })));
}

/* 회식 자리로는 안 쓰는 분류 */
const SKIP = ["카페", "간식", "제과", "베이커리", "디저트", "아이스크림", "패스트푸드", "햄버거",
  "분식", "김밥", "떡볶이", "도시락", "샌드위치", "토스트", "샐러드", "푸드코트", "구내식당"];
const KEYWORDS = ["고기집", "곱창", "이자카야", "횟집", "중식", "술집", "한식"];

export function placeFromDoc(d, base) {
  const lat = +d.y, lng = +d.x;
  return {
    id: "k" + d.id, kakaoId: String(d.id), name: esc(d.place_name), cat: esc(catOf(d.category_name)),
    kcat: esc(d.category_name), addr: esc(d.road_address_name || d.address_name || ""), phone: esc(d.phone || ""),
    lat, lng, office: base.key, rated: false, score: 0, count: 0, recNo: 0, rec: true,
    budget: 0, fit: null, room: null, parking: null, noise: "", reviews: [], closedReports: 0, isNew: true,
    dist: distOf(base.lat, base.lng, lat, lng)
  };
}

/* 카카오 검색 하나를 3페이지(45곳)까지 따라간다 */
function collect(run) {
  return new Promise(resolve => {
    const out = [];
    run((data, st, pg) => {
      if (st === kakao.maps.services.Status.OK) out.push(...data);
      if (st === kakao.maps.services.Status.OK && pg && pg.hasNextPage && pg.current < 3) pg.nextPage();
      else resolve(out);
    });
  });
}

const cache = new Map();
export function nearby(base) {
  const key = `${base.lat.toFixed(4)},${base.lng.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    if (!(await loadMaps())) return [];
    const ps = new kakao.maps.services.Places();
    const opt = { location: new kakao.maps.LatLng(base.lat, base.lng), radius: CONFIG.NEAR_RADIUS,
      sort: kakao.maps.services.SortBy.DISTANCE };
    const runs = [cb => ps.categorySearch("FD6", cb, opt),
      ...KEYWORDS.map(k => cb => ps.keywordSearch(k, cb, { ...opt, category_group_code: "FD6" }))];
    const docs = (await Promise.all(runs.map(collect))).flat();
    const byId = new Map();
    docs.forEach(d => { if (!SKIP.some(w => (d.category_name || "").includes(w))) byId.set(d.id, d); });
    return [...byId.values()].map(d => placeFromDoc(d, base)).sort((a, b) => a.dist - b.dist);
  })();
  cache.set(key, job);
  job.then(list => { if (!list.length) cache.delete(key); });   // 실패했으면 다음에 다시
  return job;
}

export async function searchPlaces(q, base) {
  if (!q || !(await loadMaps())) return [];
  const ps = new kakao.maps.services.Places();
  const docs = await collect(cb => ps.keywordSearch(q, cb, {
    location: new kakao.maps.LatLng(base.lat, base.lng), radius: 5000, category_group_code: "FD6" }));
  return docs.map(d => placeFromDoc(d, base));
}

/* 옛 등록 데이터는 이름뿐이다. 등록된 사옥 근처에서 가까운 순으로 이름을 찾아 좌표와 카카오ID를 붙인다 */
export async function resolveLegacy(places, offices) {
  if (!(await loadMaps())) return 0;
  const ps = new kakao.maps.services.Places();
  const need = places.filter(p => p.legacy && !p.lat);
  let found = 0;
  await Promise.all(need.map((p, i) => new Promise(done => setTimeout(() => {
    const home = offices.find(o => o.key === p.office) || offices[0];
    ps.keywordSearch(p.name.replace(/&[a-z#0-9]+;/g, " "), (res, st) => {
      if (st === kakao.maps.services.Status.OK && res[0]) {
        const d = res[0];
        Object.assign(p, { lat: +d.y, lng: +d.x, kakaoId: String(d.id), addr: esc(d.road_address_name || d.address_name || ""),
          phone: p.phone || esc(d.phone || ""), kcat: esc(d.category_name || "") });
        found++;
      }
      done();
    }, { location: new kakao.maps.LatLng(home.lat, home.lng), radius: CONFIG.LEGACY_RADIUS,
      sort: kakao.maps.services.SortBy.DISTANCE });
  }, i * 60))));
  return found;
}

/* ── 지도 ─────────────────────────────────── */
const overlays = new WeakMap();
export function makeMap(el, center, level = 5) {
  const map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(center.lat, center.lng), level });
  map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  return map;
}
/* pins: [{lat, lng, el}] — el 은 이미 만든 DOM 요소 */
export function setPins(map, pins, { fit = true, center } = {}) {
  (overlays.get(map) || []).forEach(o => o.setMap(null));
  const bounds = new kakao.maps.LatLngBounds(), list = [];
  pins.filter(p => p.lat && p.lng).forEach(p => {
    const pos = new kakao.maps.LatLng(p.lat, p.lng);
    list.push(new kakao.maps.CustomOverlay({ map, position: pos, content: p.el, yAnchor: 1.1, clickable: true }));
    bounds.extend(pos);
  });
  overlays.set(map, list);
  if (center) bounds.extend(new kakao.maps.LatLng(center.lat, center.lng));
  if (fit && list.length) map.setBounds(bounds, 40, 40, 40, 40);
  else if (center) map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
}
export const relayout = map => map && map.relayout();
