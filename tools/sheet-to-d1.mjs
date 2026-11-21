#!/usr/bin/env node
/* ═══════════════════════════════════════════════════
   구글 시트 → D1 이관. 한 번만 돌리면 된다.

   옛 등록 폼 행은 좌표가 없어서, 가게 이름을 그 행이 적어둔 기준점(사옥) 근처에서
   카카오로 찾아 카카오ID와 좌표를 붙인다. 못 찾은 행은 건너뛰고 끝에 보고한다.

   사용법
     KAKAO_REST_KEY=xxxx node tools/sheet-to-d1.mjs
     cd worker && npx wrangler d1 execute hoesikgak --remote --file=../tools/out/seed.sql

   결과 (tools/out/)
     seed.sql     D1 에 넣을 INSERT 문
     skipped.csv  못 옮긴 행과 이유
   ═══════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "out");
const LOCAL = "https://dapi.kakao.com/v2/local";

/* ── js/config.js 에서 설정 읽기 ───────────── */
export function readConfig(src) {
  const sheetId = src.match(/SHEET_ID:\s*"([^"]+)"/)?.[1];
  const rating = src.match(/RATING_SHEET:\s*"([^"]+)"/)?.[1];
  const legacy = src.match(/LEGACY_SHEET:\s*"([^"]+)"/)?.[1];
  const bases = [...src.matchAll(
    /\{\s*key:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*addr:\s*"[^"]*",\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)\s*\}/g
  )].map(m => ({ key: m[1], lat: +m[2], lng: +m[3] }));
  if (!sheetId) throw new Error("js/config.js 에서 SHEET_ID 를 못 읽었습니다");
  return { sheetId, rating, legacy, bases };
}

/* ── CSV ──────────────────────────────────── */
export function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}
/* 폼 질문 제목이 열 이름이 되므로 앞 번호와 괄호 설명을 떼고 공백을 지운다 */
const normHead = h => String(h || "").trim()
  .replace(/^[0-9０-９]+\s*[.)\]]\s*/, "").replace(/\s*[(（[].*$/, "").replace(/\s+/g, "");
function toObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(normHead);
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/* ── 값 다듬기 (js/data.js 와 같은 규칙) ───── */
const T = v => String(v ?? "").trim();
export function starScore(v) {
  const raw = T(v);
  if (!raw) return null;
  if (/아깝/.test(raw)) return 0;
  const d = raw.replace(/[^0-9.]/g, "");
  if (d) { const n = parseFloat(d); if (!isNaN(n) && n >= 0 && n <= 5) return n; }
  const stars = (raw.match(/[⭐★]/g) || []).length;
  return stars > 0 && stars <= 5 ? stars : null;
}
const numOf = v => { const n = parseFloat(T(v).replace(/[^0-9.]/g, "")); return isNaN(n) ? null : Math.round(n); };
const pick1 = (v, allowed) => allowed.includes(T(v)) ? T(v) : null;
const sql = v => v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const num = v => v === null || v === undefined || v === "" ? "NULL" : Number(v);

/* ── 카카오 장소 찾기 ───────────────────────── */
async function findPlace(name, base, key) {
  const u = new URL(LOCAL + "/search/keyword.json");
  u.searchParams.set("query", name);
  u.searchParams.set("category_group_code", "FD6");
  if (base) { u.searchParams.set("x", base.lng); u.searchParams.set("y", base.lat);
    u.searchParams.set("radius", "6000"); u.searchParams.set("sort", "distance"); }
  const r = await fetch(u, { headers: { Authorization: "KakaoAK " + key } });
  if (!r.ok) throw new Error("카카오 " + r.status + " — REST 키를 확인하세요");
  const d = await r.json();
  return (d.documents || [])[0] || null;
}

async function sheet(id, name) {
  const u = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`시트 "${name}" HTTP ${r.status}`);
  return toObjects(parseCSV(await r.text()));
}

async function main() {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) throw new Error("KAKAO_REST_KEY 환경변수가 필요합니다");
  const cfg = readConfig(readFileSync(join(ROOT, "js", "config.js"), "utf8"));

  /* 평가 탭을 먼저, 없거나 옛 형식이면 옛 폼 탭을 읽는다 */
  let rows = [];
  try {
    const r = await sheet(cfg.sheetId, cfg.rating);
    if (r.length && "카카오ID" in r[0]) rows = r.map(x => ({ ...x, _new: true }));
  } catch { /* 평가 탭이 없을 수 있다 */ }
  if (!rows.length) {
    rows = (await sheet(cfg.sheetId, cfg.legacy)).map(x => ({ ...x, _new: false }));
    console.log(`평가 탭이 비어 옛 폼 탭을 읽었습니다: ${rows.length}행`);
  } else console.log(`평가 탭: ${rows.length}행`);

  const places = new Map(), ratings = [], skipped = [];
  let i = 0;
  for (const r of rows) {
    i++;
    const name = T(r["매장명"]);
    if (!name) { skipped.push([i, "", "매장명 없음"]); continue; }
    const score = starScore(r["_new" in r && r._new ? "별점" : "평점"] ?? r["별점"] ?? r["평점"]);

    let id = T(r["카카오ID"]).replace(/\D/g, "");
    let lat = numOf(r["위도"]), lng = numOf(r["경도"]);
    let cat = T(r["업종"]), kcat = T(r["카카오분류"]), addr = T(r["주소"]);
    if (!id || !lat || !lng) {
      const base = cfg.bases.find(b => b.key === T(r["사옥"] || r["오피스"] || r["기준"])) || cfg.bases[0];
      const d = await findPlace(name, base, key);
      await new Promise(s => setTimeout(s, 60));           // 카카오에 몰아치지 않게
      if (!d) { skipped.push([i, name, "카카오에서 못 찾음"]); continue; }
      id = String(d.id); lat = +d.y; lng = +d.x;
      kcat = kcat || d.category_name || "";
      addr = addr || d.road_address_name || d.address_name || "";
      if (d.place_name.replace(/\s/g, "") !== name.replace(/\s/g, ""))
        skipped.push([i, name, `확인 필요 — "${d.place_name}" 로 매칭`]);
    }
    places.set(id, { id, name, cat: cat || "기타", kcat, addr, lat, lng });

    const closed = /\[폐업\]/.test(T(r["한줄평"])) ? 1 : 0;
    if (score === null && !closed) { skipped.push([i, name, "별점 없음"]); continue; }
    ratings.push({
      id, author: T(r["작성자"]) || `legacy-${i}`,
      score: closed && score === null ? null : score,
      budget: numOf(r["인당예산"]),
      room: pick1(r["룸"], ["있음", "없음"]), parking: pick1(r["주차"], ["가능", "불가"]),
      noise: pick1(r["소음"], ["조용", "보통", "시끄러움"]),
      fit: pick1(r["적정인원"], ["4명 이하", "5~8명", "9~12명", "13~20명", "20명 이상"]),
      text: closed ? "" : T(r["한줄평"] || r["후기"]).slice(0, 300),
      closed, reqId: `seed-${i}`
    });
  }

  const now = Math.floor(Date.now() / 1000);
  /* D1 은 SQL 파일 안의 BEGIN TRANSACTION / COMMIT 을 거부한다.
     파일 하나를 넣는 건 d1 execute 가 알아서 묶어 보내므로 직접 쓸 필요가 없다 */
  const out = ["-- tools/sheet-to-d1.mjs 가 만든 파일. 한 번만 넣으면 된다"];
  for (const p of places.values())
    out.push(`INSERT INTO places (kakao_id,name,cat,kcat,addr,lat,lng) VALUES (${sql(p.id)},${sql(p.name)},${sql(p.cat)},${sql(p.kcat)},${sql(p.addr)},${p.lat},${p.lng})
  ON CONFLICT(kakao_id) DO UPDATE SET name=excluded.name, addr=excluded.addr, lat=excluded.lat, lng=excluded.lng;`);
  for (const r of ratings)
    out.push(`INSERT INTO ratings (kakao_id,author,score,budget,room,parking,noise,fit,text,closed,req_id,created_at) VALUES (${sql(r.id)},${sql(r.author)},${num(r.score)},${num(r.budget)},${sql(r.room)},${sql(r.parking)},${sql(r.noise)},${sql(r.fit)},${sql(r.text)},${r.closed},${sql(r.reqId)},${now})
  ON CONFLICT(kakao_id,author) DO NOTHING;`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "seed.sql"), out.join("\n") + "\n");
  writeFileSync(join(OUT, "skipped.csv"),
    "행,매장명,사유\n" + skipped.map(s => s.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n");

  console.log(`\n가게 ${places.size}곳, 평가 ${ratings.length}줄 → tools/out/seed.sql`);
  if (skipped.length) console.log(`건너뛰거나 확인이 필요한 행 ${skipped.length}개 → tools/out/skipped.csv`);
  console.log(`\n넣기:\n  cd worker && npx wrangler d1 execute hoesikgak --remote --file=../tools/out/seed.sql`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error("\n실패:", e.message); process.exit(1); });
