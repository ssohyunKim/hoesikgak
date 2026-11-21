#!/usr/bin/env node
/* ═══════════════════════════════════════════════════
   푸시 전 미리보기 — 고친 파일을 진짜 서비스에 붙여서 본다.

   왜 localhost 로는 안 되나
     Worker 는 https://www.hoesikgak.com 에서 온 요청만 받고(CORS),
     카카오도 등록된 도메인에서만 SDK·로그인을 허용한다.
   그래서 브라우저 주소는 www.hoesikgak.com 그대로 두고,
   그 주소의 파일만 이 저장소의 파일로 바꿔치기한다.
   Worker·카카오·지도는 전부 진짜를 쓴다.

   실행
     PW_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
       node tools/preview.mjs
   창을 닫으면 끝난다.

   주의: 진짜 서비스라서 로그인하면 실제 세션이 생기고,
        회사 위치를 등록하면 KV 에, 별점을 남기면 D1 에 진짜로 쓰인다.
   ═══════════════════════════════════════════════════ */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.hoesikgak.com";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || undefined,
  headless: false, args: ["--window-size=430,900"]
});
const ctx = await browser.newContext({ viewport: { width: 430, height: 860 } });
const page = await ctx.newPage();

/* 사이트 파일만 이 저장소에서 꺼내 준다 */
let served = 0;
await page.route(SITE + "/**", route => {
  let path = new URL(route.request().url()).pathname;
  if (path === "/") path = "/index.html";
  const file = join(ROOT, path);
  if (!existsSync(file) || !file.startsWith(ROOT)) {
    console.log("  404", path);
    return route.fulfill({ status: 404, body: "" });
  }
  served++;
  route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] || "application/octet-stream" });
});

/* 무슨 일이 일어나는지 터미널에 보여준다 */
page.on("console", m => {
  const t = m.type();
  if (t === "error" || t === "warning") console.log(`  [${t}]`, m.text().slice(0, 200));
});
page.on("pageerror", e => console.log("  [오류]", e.message));
page.on("requestfailed", r => {
  const u = r.url();
  if (!u.startsWith(SITE)) console.log("  [실패]", r.failure()?.errorText, u.slice(0, 110));
});
page.on("response", async res => {
  const u = res.url();
  if (/workers\.dev|kauth\.kakao|kapi\.kakao/.test(u))
    console.log(`  [API] ${res.status()} ${u.replace(/^https:\/\//, "").slice(0, 100)}`);
});

console.log(`미리보기: ${ROOT}\n파일은 로컬, Worker·카카오·지도는 진짜입니다.`);
console.log("창을 닫으면 끝납니다.\n");
await page.goto(SITE + "/");

await new Promise(done => { page.on("close", done); browser.on("disconnected", done); });
console.log(`\n끝. 로컬에서 내보낸 파일 ${served}개.`);
await browser.close().catch(() => {});
