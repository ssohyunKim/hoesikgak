#!/usr/bin/env node
/* ═══════════════════════════════════════════════════
   옛 폼 응답을 "평가" 탭 형식으로 옮긴다. 한 번만 돌리면 된다.

   사용법
     KAKAO_REST_KEY=xxxx node tools/migrate-legacy.mjs

   - 가게 이름을 그 가게가 등록된 사옥 근처에서 카카오로 찾아 카카오ID와 좌표를 붙인다.
   - 별점이 없는 행은 옮기지 않는다. 별점 없는 가게는 사이트의 "가봤어요?" 탭에 알아서 뜬다.
   - 작성자는 legacy-행번호 로 넣는다. 사이트는 이 값이 보이면 옛 폼 응답 시트를 더 읽지 않는다.

   결과 (tools/out/ 아래)
     rating-migrate.tsv   평가 탭(별점 폼 응답 탭)에 붙일 행. 머리글 없이 데이터만 있다.
                          열 순서는 tools/rating-form.md 의 질문 순서 + 검증, 영업상태.
                          머리글 바로 아래 첫 빈 행의 A열을 누르고 붙여넣는다.
                          (macOS: pbcopy < tools/out/rating-migrate.tsv)
     migrate-check.csv    찾은 결과 확인용. "확인 필요"는 이름이 다른 가게가 잡혔을 수 있는 행이다.
   ═══════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const API = "https://dapi.kakao.com/v2/local";
/* 별점 폼 응답 탭의 열 순서: 타임스탬프 + 폼 질문 순서(tools/rating-form.md) + 손으로 붙인 검증, 영업상태 */
const HEAD = ["타임스탬프", "카카오ID", "매장명", "업종", "카카오분류", "주소", "위도", "경도",
  "별점", "인당예산", "룸", "주차", "소음", "적정인원", "한줄평", "작성자", "기준", "요청ID", "검증", "영업상태"];

/* ── index.html 에서 설정 읽기 ─────────────── */
export function readConfig(html) {
  const sheetId = html.match(/SHEET_ID:\s*"([^"]+)"/)?.[1];
  const sheetName = html.match(/SHEET_NAME:\s*"([^"]+)"/)?.[1];
  const offices = [...html.matchAll(
    /\{\s*key:"([^"]+)",\s*name:"([^"]+)",\s*addr:"([^"]+)",\s*lat:([\d.]+),\s*lng:([\d.]+)\s*\}/g
  )].map(m => ({ key: m[1], name: m[2], addr: m[3], lat: +m[4], lng: +m[5] }));
  if (!sheetId || !offices.length) throw new Error("index.html 에서 CONFIG 를 못 읽었습니다");
  return { sheetId, sheetName, offices };
}

/* ── CSV / TSV ────────────────────────────── */
export function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}
const csvCell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
const toTSV = rows => rows.map(r => r.map(v => String(v ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + "\n";

/* 사이트의 normHead 와 같은 규칙. "3. 인당 예산 (숫자만…)" → "인당예산" */
export const normHead = h => String(h).trim()
  .replace(/^[0-9０-９]+\s*[.)\]]\s*/, "").replace(/\s*[(（[].*$/, "").replace(/\s+/g, "");

/* 이름 비교용. 지점은 띄어 쓴 마지막 덩어리로만 판단한다 */
export const normName = s => String(s).replace(/\(.*?\)/g, "").trim()
  .replace(/\s+(\S+점|본관|별관)$/, "").replace(/\s+/g, "").toLowerCase();
export function sameShop(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
}

/* 사이트의 starScore 와 같은 규칙. 별 이모지 개수 또는 숫자. 안 매겼으면 null */
export function starScore(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (/아깝/.test(raw)) return 0;
  const d = raw.replace(/[^0-9.]/g, "");
  if (d) { const n = parseFloat(d); if (!isNaN(n) && n >= 0 && n <= 5) return n; }
  const stars = (raw.match(/[⭐★]/g) || []).length;
  return stars > 0 && stars <= 5 ? stars : null;
}

/* ── 카카오 ───────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function kakao(path, params, key) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`,
    { headers: { Authorization: `KakaoAK ${key}` } });
  if (res.status === 401 || res.status === 403)
    throw new Error(`카카오 인증 실패(${res.status}). REST API 키인지, 콘솔에서 '카카오맵' 사용이 켜져 있는지 확인하세요`);
  if (!res.ok) throw new Error(`카카오 ${path} HTTP ${res.status}: ${await res.text()}`);
  await sleep(120);
  return res.json();
}

async function main() {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) { console.error("KAKAO_REST_KEY 환경변수가 필요합니다. (카카오 콘솔의 REST API 키)"); process.exit(1); }
  const cfg = readConfig(readFileSync(join(ROOT, "index.html"), "utf8"));

  for (const o of cfg.offices) {
    const j = await kakao("search/address.json", { query: o.addr }, key);
    if (j.documents?.[0]) { o.lat = +j.documents[0].y; o.lng = +j.documents[0].x; }
  }
  const officeOf = k => cfg.offices.find(o => o.key === k) || cfg.offices[0];

  const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(cfg.sheetName)}`;
  const sheet = parseCSV(await (await fetch(url)).text());
  const H = sheet[0].map(normHead);
  const rows = sheet.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, (r[i] || "").trim()])));

  const outRows = [], check = [["시트 행", "상태", "시트 매장명", "카카오 매장명", "카카오 분류", "주소", "카카오맵"]];
  let moved = 0, skipped = 0, missing = 0, unsure = 0;
  for (const [i, r] of rows.entries()) {
    const line = i + 2, name = r["매장명"];
    if (!name) continue;
    const score = starScore(r["평점"]);
    if (score === null) { skipped++; check.push([line, "별점 없음, 건너뜀", name]); continue; }
    const o = officeOf(r["사옥"] || r["오피스"]);
    const j = await kakao("search/keyword.json",
      { query: name, x: o.lng, y: o.lat, radius: 6000, sort: "distance" }, key);
    const docs = j.documents || [];
    const d = docs.find(x => sameShop(name, x.place_name)) || docs[0];
    if (!d) { missing++; check.push([line, "못 찾음, 건너뜀", name]); continue; }
    const sure = sameShop(name, d.place_name);
    if (!sure) unsure++;
    check.push([line, sure ? "OK" : "확인 필요", name, d.place_name, d.category_name,
      d.road_address_name || d.address_name, d.place_url]);
    outRows.push([
      r["타임스탬프"], d.id, d.place_name, r["업종"], d.category_name, d.road_address_name || d.address_name,
      d.y, d.x, score, (r["인당예산"] || "").replace(/[^0-9]/g, ""), r["룸"], r["주차"], r["소음"],
      r["적정인원"], r["후기"] || r["아쉬운점"] || "", `legacy-${line}`, o.key, `legacy-${line}`, r["검증"], r["영업상태"]
    ]);
    moved++;
  }

  const out = join(HERE, "out"); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "rating-migrate.tsv"), toTSV(outRows));
  writeFileSync(join(out, "migrate-check.csv"), "﻿" + toCSV(check));
  console.log(`옮김 ${moved}행 (확인 필요 ${unsure}) · 별점 없어서 건너뜀 ${skipped} · 카카오에서 못 찾음 ${missing}`);
  console.log(`붙여넣기  tools/out/rating-migrate.tsv  → "평가" 탭 머리글 아래 첫 빈 행 A열에 붙여넣기`);
  console.log(`확인용    tools/out/migrate-check.csv`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error("\n" + e.message); process.exit(1); });
}
