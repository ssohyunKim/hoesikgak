/* ═══════════════════════════════════════════════════
   데이터 — 구글 시트 읽기와 가게 집계

   평가 탭 열: 타임스탬프 카카오ID 매장명 업종 카카오분류 주소 위도 경도 별점 인당예산
               룸 주차 소음 적정인원 한줄평 작성자 기준 요청ID 검증 영업상태
   - 카카오ID로 묶는다. 같은 작성자가 여러 번 남기면 마지막 행만 센다.
   - 선택 정보는 가장 많이 나온 값, 예산은 중앙값.
   - 옛 등록 폼(이름만 있음)은 평가 탭에 이관 행(작성자 legacy-*)이 생기기 전까지 같이 읽는다.
   ═══════════════════════════════════════════════════ */
import { CONFIG } from "./config.js";
import { esc, T, distOf } from "./util.js";
import * as store from "./store.js";

/* ── 파싱 ─────────────────────────────────── */
export function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}
/* 폼 질문 제목이 열 이름이 된다. "3. 인당 예산 (숫자만…)" → "인당예산" */
export const normHead = h => T(h).replace(/^[0-9０-９]+\s*[.)\]]\s*/, "").replace(/\s*[(（[].*$/, "").replace(/\s+/g, "");
export function toObjects(rows) {
  if (rows.length < 2) return [];
  const head = rows[0].map(normHead);
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || ""])));
}

/* 숫자 또는 별 이모지. 안 매긴 칸은 null, "0"과 "별점도 아깝다"는 0 */
export function starScore(v) {
  const raw = T(v);
  if (!raw) return null;
  if (/아깝/.test(raw)) return 0;
  const d = raw.replace(/[^0-9.]/g, "");
  if (d) { const n = parseFloat(d); if (!isNaN(n) && n >= 0 && n <= 5) return n; }
  const stars = (raw.match(/[⭐★]/g) || []).length;
  return stars > 0 && stars <= 5 ? stars : null;
}
/* "4명 이하" / "5~8명" / "20명 이상" / "12" */
export function parseHead(v) {
  const s = T(v);
  if (!s || /모르|미확인|해당/.test(s)) return null;
  const n = (s.match(/\d+/g) || []).map(Number);
  if (!n.length) return null;
  if (/이상|넘/.test(s)) return { min: n[0], max: 99, label: `${n[0]}명 이상` };
  if (/이하|까지|미만/.test(s)) return { min: 2, max: n[0], label: `${n[0]}명 이하` };
  if (n.length >= 2) return { min: n[0], max: n[1], label: `${n[0]}~${n[1]}명` };
  return { min: 2, max: n[0], label: `${n[0]}명까지` };
}
export function tri(v) {
  const s = T(v).toLowerCase();
  if (["가능", "o", "y", "yes", "있음", "1"].includes(s)) return true;
  if (["불가", "x", "n", "no", "없음", "0"].includes(s)) return false;
  return null;
}
/* 룸은 "8인룸 2개" 같은 자유 서술도 온다. 없다는 말이 아니면 있음으로 본다 */
export function roomOf(v) {
  const s = T(v);
  if (!s || /모르|미확인/.test(s)) return null;
  return tri(s) ?? true;
}
const numOf = v => { const n = parseFloat(T(v).replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
const VERIFY = ["o", "y", "yes", "완료", "검증", "검증완료", "확인", "true", "1", "v"];

/* 카카오 분류 → 업종. 위에서부터 먼저 걸리는 쪽 */
const CAT_RULES = [[/곱창|막창|대창/, "곱창"], [/육류|고기|삼겹|갈비|족발|보쌈|오리|닭갈비/, "고기"],
  [/일본식주점|이자카야/, "이자카야"], [/해물|생선|회|조개|장어|대게/, "해산물"],
  [/일식|초밥|돈까스|라멘|우동/, "일식"], [/중식|중국|양꼬치|훠궈|마라/, "중식"],
  [/양식|이탈리안|스테이크|피자|파스타|프랑스/, "양식"], [/한식|한정식|국밥|찌개|샤브/, "한식"]];
export function catOf(kcat) {
  for (const [re, c] of CAT_RULES) if (re.test(kcat || "")) return c;
  return "기타";
}

function mode(vals) {
  const c = new Map(); let best = "", bn = 0;
  vals.map(T).filter(Boolean).forEach(v => { const n = (c.get(v) || 0) + 1; c.set(v, n); if (n >= bn) { bn = n; best = v; } });
  return best;
}
function median(nums) {
  const a = nums.filter(n => n > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2 / 1000) * 1000;
}
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const isBad = s => s !== null && s <= 1;
export const recOf = p => !(p.rated && p.score <= 1);

function nearestOffice(lat, lng, offices) {
  let best = "", bd = Infinity;
  offices.forEach(o => { const d = distOf(lat, lng, o.lat, o.lng); if (d < bd) { bd = d; best = o.key; } });
  return bd <= CONFIG.NEAR_RADIUS * 2 ? best : "";
}

/* ── 평가 탭 → 가게 ─────────────────────────── */
export function aggregate(rows, offices = CONFIG.OFFICES) {
  const groups = new Map();
  rows.forEach((r, i) => {
    const id = T(r["카카오ID"]).replace(/\.0+$/, "");
    if (!/^\d+$/.test(id)) return;
    if (!groups.has(id)) groups.set(id, new Map());
    groups.get(id).set(T(r["작성자"]) || "row" + i, r);   // 작성자별 마지막 행
  });
  const out = [];
  groups.forEach((byAuthor, id) => {
    const g = [...byAuthor.values()], last = g[g.length - 1];
    if (g.some(r => T(r["영업상태"]) === "폐업")) return;
    const scores = g.map(r => starScore(r["별점"])).filter(s => s !== null);
    const lat = +T(last["위도"]) || null, lng = +T(last["경도"]) || null;
    const p = {
      id: "k" + id, kakaoId: id,
      name: esc(T(last["매장명"])), cat: esc(mode(g.map(r => r["업종"])) || catOf(last["카카오분류"])),
      kcat: esc(T(last["카카오분류"])), addr: esc(T(last["주소"])), phone: "",
      lat, lng, office: lat && lng ? nearestOffice(lat, lng, offices) : T(last["기준"]),
      rated: scores.length > 0, score: scores.length ? avg(scores) : 0, count: scores.length,
      recNo: g.filter(r => isBad(starScore(r["별점"]))).length,
      budget: median(g.map(r => numOf(r["인당예산"]))),
      fit: parseHead(mode(g.map(r => r["적정인원"]))),
      room: roomOf(mode(g.map(r => r["룸"]))), parking: tri(mode(g.map(r => r["주차"]))),
      noise: esc(mode(g.map(r => r["소음"]))),
      reviews: g.filter(r => T(r["한줄평"])).reverse()
        .map(r => ({ txt: esc(T(r["한줄평"])), bad: isBad(starScore(r["별점"])) })),
      verified: g.some(r => VERIFY.includes(T(r["검증"]).toLowerCase())),
      isNew: false
    };
    p.rec = recOf(p);
    out.push(p);
  });
  return out;
}

/* ── 옛 등록 폼 → 가게 (좌표·카카오ID는 지도에서 이름으로 찾은 뒤 채워진다) ── */
export function legacyPlaces(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const name = T(r["매장명"]);
    if (!name || T(r["영업상태"]) === "폐업") return;
    const office = T(r["사옥"] || r["오피스"]);
    const key = name.replace(/\s/g, "") + "|" + office;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  let n = 0;
  return [...groups.values()].map(g => {
    const first = g[0];
    const scores = g.map(r => starScore(r["평점"])).filter(s => s !== null);
    const p = {
      id: "L" + (n++), kakaoId: "", name: esc(T(first["매장명"])), cat: esc(mode(g.map(r => r["업종"])) || "기타"),
      kcat: "", addr: "", phone: "", lat: null, lng: null, office: T(first["사옥"] || first["오피스"]),
      rated: scores.length > 0, score: scores.length ? avg(scores) : 0, count: scores.length,
      recNo: scores.filter(isBad).length,
      budget: median(g.map(r => numOf(r["인당예산"]))),
      fit: parseHead(mode(g.map(r => r["적정인원"]))),
      room: roomOf(mode(g.map(r => r["룸"]))), parking: tri(mode(g.map(r => r["주차"]))),
      noise: esc(mode(g.map(r => r["소음"]))),
      reviews: g.filter(r => T(r["후기"])).map(r => ({ txt: esc(T(r["후기"])), bad: isBad(starScore(r["평점"])) })),
      verified: g.some(r => VERIFY.includes(T(r["검증"]).toLowerCase())),
      isNew: false, legacy: true
    };
    p.rec = recOf(p);
    return p;
  });
}

/* 옛 데이터와 새 평가가 같은 가게면 합친다. 빈 칸은 서로 채우고 별점은 인원 수로 가중평균 */
export function combine(b, a) {
  const p = { ...b };
  if (a.count) { p.score = (b.score * b.count + a.score * a.count) / (b.count + a.count); p.rated = true; }
  p.count = b.count + a.count;
  for (const k of ["budget", "noise", "addr", "kcat", "lat", "lng"]) if (!p[k]) p[k] = a[k];
  for (const k of ["room", "parking", "fit"]) if (p[k] === null) p[k] = a[k];
  p.reviews = a.reviews.concat(b.reviews);
  p.recNo = b.recNo + a.recNo;
  p.verified = b.verified || a.verified;
  p.kakaoId = a.kakaoId; p.id = a.id;
  p.rec = recOf(p);
  return p;
}
export function mergeAll(legacy, agg) {
  const byK = new Map(agg.map(p => [p.kakaoId, p]));
  const out = legacy.map(b => {
    const a = b.kakaoId && byK.get(b.kakaoId);
    if (!a) return b;
    byK.delete(b.kakaoId);
    return combine(b, a);
  });
  return out.concat([...byK.values()]);
}

/* 방금 남긴 평가는 시트에 반영되기까지 몇 분 걸린다. 그동안 이 브라우저에 들고 있는다 */
export function mergePending(rows, pending, now = Date.now()) {
  const seen = new Set(rows.map(r => T(r["요청ID"])).filter(Boolean));
  const keep = pending.filter(r => !seen.has(r["요청ID"]) && now - r._t < 3 * 864e5);
  return { rows: rows.concat(keep), keep };
}

/* ── 불러오기 ─────────────────────────────── */
const PENDING_KEY = "hoesik.pending";
export const db = { rows: [], legacy: [], ok: false };

async function sheet(name) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return toObjects(parseCSV(await res.text()));
}
export async function loadPlaces() {
  let rows = [], migrated = false, ok = false;
  try {
    rows = await sheet(CONFIG.RATING_SHEET);
    /* 평가 탭이 없으면 gviz 가 첫 탭을 돌려준다. 카카오ID 열이 없으면 평가 탭이 아니다 */
    if (rows.length && !("카카오ID" in rows[0])) rows = [];
    migrated = rows.some(r => /^legacy/.test(T(r["작성자"])));
    ok = true;
  } catch (e) { console.warn("평가 탭을 읽지 못했습니다:", e.message); }
  const merged = mergePending(rows, store.get(PENDING_KEY, []));
  store.set(PENDING_KEY, merged.keep);
  db.rows = merged.rows;
  db.legacy = [];
  if (!migrated) {
    try { db.legacy = legacyPlaces(await sheet(CONFIG.LEGACY_SHEET)); ok = true; }
    catch (e) { console.warn("옛 등록 시트를 읽지 못했습니다:", e.message); }
  }
  db.ok = ok;
  return ok;
}
export const currentPlaces = () => mergeAll(db.legacy, aggregate(db.rows));
export function addPendingRow(row) {
  db.rows.push(row);
  store.set(PENDING_KEY, store.get(PENDING_KEY, []).concat(row));
}
