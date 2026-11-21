/* 카카오 로그인 흐름 테스트 (Playwright).
   config.js 를 가로채 API_BASE 를 채워 "배포된 상태"를 흉내 낸다.
   카카오 인증 화면과 Worker 는 이 파일 안의 가짜로 대신한다.
   실행: PW_CHROME="…/Google Chrome" node tests/e2e/login.mjs */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const API = 'https://api.test';
const UID = 'k_' + 'ab'.repeat(12);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 860 } });
const p = await ctx.newPage();

const errs = [], seen = { sheet: 0, form: 0, auth: [], rate: [] };
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

const CT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
await p.route('https://www.hoesikgak.com/**', r => {
  let path = new URL(r.request().url()).pathname;
  if (path === '/') path = '/index.html';
  const f = join(ROOT, path);
  if (!existsSync(f)) return r.fulfill({ status: 404, body: '' });
  let body = readFileSync(f);
  /* 배포 뒤처럼 API_BASE 를 채운다 */
  /* 실제 주소가 들어 있어도 가짜 Worker 로 돌린다 */
  if (path === '/js/config.js') body = String(body).replace(/API_BASE:\s*"[^"]*"/, `API_BASE: "${API}"`);
  r.fulfill({ body, contentType: CT[extname(f)] || 'application/octet-stream' });
});
/* 가짜 카카오 SDK — authorize 는 인가 코드를 붙여 사이트로 되돌린다 */
await p.route('https://t1.kakaocdn.net/**', r => r.fulfill({ contentType: 'text/javascript', body: `
  window.Kakao={_i:false,init(){this._i=true},isInitialized(){return this._i},
    Share:{sendDefault(o){window.__shared=o;}},
    Auth:{authorize(o){ try{sessionStorage.setItem("__authorize",JSON.stringify(o));}catch(e){}
      location.href=o.redirectUri+"?code=TESTCODE&state="+encodeURIComponent(o.state||""); }}};` }));
await p.route('https://dapi.kakao.com/**', r => r.fulfill({ body: readFileSync(join(HERE, 'kmaps.js')), contentType: 'text/javascript' }));
await p.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
await p.route('https://docs.google.com/spreadsheets/**', r => { seen.sheet++;
  const u = decodeURIComponent(r.request().url());
  r.fulfill({ body: readFileSync(join(HERE, u.includes('sheet=평가') ? 'rating.csv' : 'legacy.csv'), 'utf8'), contentType: 'text/csv' }); });
await p.route('https://docs.google.com/forms/**', r => { seen.form++; r.fulfill({ body: 'ok' }); });
/* 가짜 Worker */
await p.route(API + '/auth/kakao', r => { seen.auth.push(JSON.parse(r.request().postData()));
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, uid: UID, token: 'tok.sig',
    exp: Math.floor(Date.now() / 1000) + 2592000 }) }); });
let kv = null;
await p.route(API + '/me', r => { const b = JSON.parse(r.request().postData());
  if (b.place !== undefined) kv = b.place;
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, place: kv }) }); });
/* D1 에서 오는 평가 행 (Worker 가 주는 영어 키 모양) */
const D1ROWS = [
  { kakaoId:'900001', name:'디원고기집', cat:'고기', kcat:'음식점 > 한식', addr:'서울 관악구 1',
    lat:37.4999, lng:126.9214, author:'k_x1', score:5, budget:40000, room:'있음', parking:'가능',
    noise:'보통', fit:'5~8명', text:'디원에서 온 평가', closed:0, reqId:'d1' },
  { kakaoId:'900001', name:'디원고기집', cat:'고기', kcat:'음식점 > 한식', addr:'서울 관악구 1',
    lat:37.4999, lng:126.9214, author:'k_x2', score:4, budget:null, room:null, parking:null,
    noise:null, fit:null, text:'두 번째 평가', closed:0, reqId:'d2' },
  { kakaoId:'900002', name:'디원비추집', cat:'한식', kcat:'음식점 > 한식', addr:'서울 관악구 2',
    lat:37.5001, lng:126.9216, author:'k_x3', score:1, budget:null, room:null, parking:null,
    noise:null, fit:null, text:'별로였음', closed:0, reqId:'d3' }
];
const rowsCalls = [];
await p.route(API + '/rows*', r => { rowsCalls.push(new URL(r.request().url()).search);
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, rows: D1ROWS }) }); });
/* 마이페이지용 가짜 내 평가 */
let MINE = [
  { kakaoId:'900001', name:'디원고기집', cat:'고기', addr:'서울 관악구 1', lat:37.4999, lng:126.9214,
    score:5, budget:40000, text:'좋아요', closed:0, createdAt: Math.floor(Date.now()/1000) },
  { kakaoId:'900003', name:'닫은집', cat:'고기', addr:'서울 관악구 3', lat:37.5002, lng:126.9218,
    score:null, budget:null, text:'', closed:1, createdAt: Math.floor(Date.now()/1000) - 86400 }
];
const myCalls = [];
await p.route(API + '/my', r => { const b = JSON.parse(r.request().postData()); myCalls.push(b);
  if (b.remove) { MINE = MINE.filter(x => x.kakaoId !== b.remove);
    return r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, deleted:1 }) }); }
  r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, ratings: MINE }) }); });
/* 가짜 투표방 서버 — 1인 1표 규칙만 흉내 낸다 */
const ROOMS = {};
await p.route(API + '/room', r => { const b = JSON.parse(r.request().postData());
  ROOMS.t1 = { id:'t1', title:b.title, base:b.base, picks:b.picks, votes:{}, closed:false, winner:'' };
  r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, id:'t1' }) }); });
await p.route(API + '/room/get', r => { const m = ROOMS.t1;
  const tally = {}; Object.values(m.votes).forEach(k => tally[k] = (tally[k]||0)+1);
  r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, room:{
    id:m.id, title:m.title, base:m.base, picks:m.picks, tally,
    voters:Object.keys(m.votes).length, mine:m.votes.me||'', closed:m.closed,
    winner:m.winner, owner:true } }) }); });
await p.route(API + '/room/vote', r => { const b = JSON.parse(r.request().postData());
  ROOMS.t1.votes.me = b.kakaoId;
  ROOMS.t1.votes.other = ROOMS.t1.votes.other || ROOMS.t1.picks[1].kakaoId;  // 다른 사람 1표
  r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true }) }); });
await p.route(API + '/room/close', r => { const b = JSON.parse(r.request().postData());
  ROOMS.t1.closed = true; ROOMS.t1.winner = b.winner;
  r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true }) }); });
await p.route(API + '/rate', r => { seen.rate.push(JSON.parse(r.request().postData()));
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });

await p.addInitScript(() => { Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { set() {}, get() { return ''; } }); });
const log = (...a) => console.log(...a);

/* ── 1. 로그인 전 ───────────────────────────── */
await p.goto('https://www.hoesikgak.com/'); await p.waitForTimeout(500);
log('① 로그인 화면:', (await p.textContent('h1.q')).replace(/\s+/g, ' ').trim());
log('   버튼:', await p.textContent('#kakaoLogin'));
log('   data-view:', await p.evaluate(() => document.body.dataset.view));
log('   지도 버튼 숨김:', !(await p.locator('#mapBtn').isVisible()));
log('   시트를 읽지 않았나:', seen.sheet === 0, '(로그인 전에는 데이터를 안 부른다)');

/* 주소를 직접 쳐도 막혀야 한다 */
await p.goto('https://www.hoesikgak.com/#/picks?s=team&n=8&at=보라매'); await p.waitForTimeout(400);
log('② 딥링크로 우회:', await p.locator('#kakaoLogin').count() === 1 ? '막힘 ✓' : '뚫림 ✗',
  '| 후보 카드:', await p.locator('.pc').count());

/* ── 2. 로그인 ─────────────────────────────── */
await p.goto('https://www.hoesikgak.com/'); await p.waitForTimeout(400);
await p.click('#kakaoLogin');
await p.waitForTimeout(1200);
/* 리다이렉트로 페이지가 바뀌므로 authorize 인자는 sessionStorage 로 건너온다 */
const az = JSON.parse(await p.evaluate(() => sessionStorage.getItem('__authorize')) || 'null');
log('③ authorize 인자:', JSON.stringify(az), '| state 가 비어 있지 않나:', !!(az && az.state));
log('   Worker 로 보낸 것:', JSON.stringify(seen.auth[0]));
log('   돌아온 주소:', await p.evaluate(() => location.href.replace('https://www.hoesikgak.com', '')),
  '(code·state 가 지워져야 한다)');
log('   세션 저장:', await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('hoesik.session') || 'null'); return s && s.uid; }));
log('   로그인 직후 화면:', (await p.textContent('h1.q')).replace(/\s+/g, ' ').trim(),
  '| data-view:', await p.evaluate(() => document.body.dataset.view));

/* ── 2-b. 회사 위치 등록 ─────────────────────── */
/* 우편번호 검색창은 외부 iframe 이라 e2e 에서는 선택 결과만 흉내 낸다 */
await p.evaluate(() => {
  window.daum = { Postcode: function (o) { this.embed = () => setTimeout(() =>
    o.oncomplete({ userSelectedType: 'R', roadAddress: '서울 중구 세종대로 110',
      address: '서울 중구 세종대로 110', buildingName: '서울특별시청' }), 10); } };
});
await p.click('#search'); await p.waitForSelector('#confirm:not([hidden])', { timeout: 10000 });
log('④ 고른 주소:', (await p.textContent('#pickedAddr')).trim());
log('   이름 기본값:', await p.inputValue('#nm'));
await p.fill('#nm', '우리 회사');
await p.click('#saveBtn'); await p.waitForTimeout(900);
log('   서버에 저장된 값:', JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('hoesik.myplace')))));
log('   등록 뒤 화면:', (await p.textContent('h1.q')).replace(/\s+/g, ' ').trim());
log('   시트 읽음:', seen.sheet > 0);
/* ── 2-c. 마법사에서 기준 칩 확인 ─────────────── */
await p.click('[data-sit="team"]'); await p.waitForSelector('#bases'); await p.waitForTimeout(200);
log('⑤ 기준 칩:', (await p.$$eval('#bases .chip', e => e.map(x => x.textContent.trim()))).join(' | '));
log('   눌린 칩:', await p.textContent('#bases .chip[aria-pressed=true]'));
await p.click('#next'); await p.waitForSelector('.pc', { timeout: 15000 }); await p.waitForTimeout(400);
const names = await p.$$eval('.pc h3', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
log('   등록한 위치 기준 후보:', names.length, '|', names.slice(0, 4).join(' / '));
/* ── 업종 칩 ─────────────────────────────── */
const chips = await p.$$eval('#cats .chip', e => e.map(x => x.textContent.replace(/\s+/g,' ').trim()));
log('⑨ 업종 칩:', chips.join(' | ') || '(없음)');
if (chips.length > 1) {
  const label = chips[1];
  const want = +label.match(/(\d+)$/)[1];
  await p.click('#cats .chip:nth-child(2)'); await p.waitForTimeout(600);
  const after = await p.$$eval('.pc h3', e => e.length);
  log(`   "${label}" 선택 → 목록 ${after}곳 (칩 숫자 ${want} 와 같아야 함):`, after === want);
  log('   주소:', decodeURIComponent(await p.evaluate(() => location.hash)));
  log('   룰렛 버튼:', (await p.textContent('#spin').catch(() => '(없음)')).replace(/\s+/g,' ').trim());
  const only = await p.$$eval('.pc', e => e.map(x => x.textContent));
  log('   다른 업종 섞였나:', only.some(t => t.includes('이자카야')) && !label.includes('이자카야') ? '섞임 ✗' : '없음 ✓');
  await p.click('#cats .chip:nth-child(1)'); await p.waitForTimeout(500);
  log('   전체로 복귀:', await p.$$eval('.pc h3', e => e.length), '곳');
}

log('⑦ /rows 호출:', rowsCalls[0], '| 구글 시트 CSV 호출:', seen.sheet, '(0 이어야 함)');
log('   D1 데이터가 후보에:', names.filter(n => n.includes('디원')).join(' / ') || '없음 ✗');
log('   주소에 사옥 흔적:', decodeURIComponent(await p.evaluate(() => location.hash)).includes('보라매') ? '남음 ✗' : '없음 ✓');

/* 기준 바꾸기 */
await p.goto('https://www.hoesikgak.com/#/setup?s=team'); await p.waitForSelector('#bases'); await p.waitForTimeout(300);
await p.click('[data-at="edit"]'); await p.waitForTimeout(400);
log('⑥ 기준 바꾸기:', (await p.textContent('h1.q')).replace(/\s+/g, ' ').trim(),
  '| 지금 값 표시:', (await p.textContent('.note')).includes('세종대로'));
await p.click('#back'); await p.waitForTimeout(400);
log('   그만두면 돌아옴:', (await p.textContent('h1.q')).replace(/\s+/g, ' ').trim());

/* ── 3. 로그인 상태로 평가 ───────────────────── */
await p.click('#mapBtn'); await p.waitForSelector('#filters', { timeout: 15000 }); await p.waitForTimeout(400);
await p.click('[data-f="new"]'); await p.locator('#list .pc').first().click(); await p.waitForTimeout(300);
await p.click('#rateBox .star[data-v="5"]'); await p.click('#rateBox [type=submit]'); await p.waitForTimeout(900);
log('④ 구글 폼 호출:', seen.form, '(0 이어야 한다 — Worker 로 가야 함)');
const r0 = seen.rate[0] || {};
log('   Worker /rate 로 간 값:', JSON.stringify({ token: r0.token, kakaoId: r0.kakaoId, score: r0.score, name: r0.name, reqId: r0.reqId }));
log('   작성자를 클라이언트가 안 보냄:', r0.author === undefined);
log('   한글 키 없음:', r0['매장명'] === undefined);

/* ── 3-a. 투표방 ─────────────────────────────── */
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.goto('https://www.hoesikgak.com/#/picks?s=team&n=8&b=3050&at=my'); await p.waitForSelector('#room', { timeout: 15000 });
await p.click('#room'); await p.waitForSelector('.pc.vote', { timeout: 10000 }); await p.waitForTimeout(300);
log('⑩ 투표방:', (await p.textContent('h1.q')).replace(/\s+/g,' ').trim(), '|', (await p.textContent('.sub')).trim().slice(0,40));
log('   주소:', decodeURIComponent(await p.evaluate(() => location.hash)));
log('   후보:', await p.locator('.pc.vote').count(), '곳 | 참여:', (await p.textContent('#cnt')).trim());
await p.locator('.pc.vote').first().click(); await p.waitForTimeout(600);
log('   투표 후 참여:', (await p.textContent('#cnt')).trim(),
  '| 내 표 표시:', await p.locator('.pc.vote[aria-pressed=true]').count(),
  '| 표 숫자:', (await p.$$eval('.pc.vote .vn', e => e.map(x=>x.textContent).filter(Boolean))).join(','));
log('   마감 버튼:', (await p.textContent('#finish')).trim());
await p.click('#finish'); await p.waitForTimeout(5200);
log('   마감 후:', (await p.textContent('h1.q')).replace(/\s+/g,' ').trim(),
  '| 당첨:', (await p.textContent('.card.winner h3').catch(()=>'(없음)')).trim());
log('   마감되면 투표 잠김:', await p.locator('.pc.vote[disabled]').count() > 0);

/* ── 3-b. 마이페이지 ─────────────────────────── */
p.on('dialog', d => d.accept());
await p.keyboard.press('Escape'); await p.waitForTimeout(300);   // 상세 시트 닫기
await p.click('#meBtn'); await p.waitForSelector('.mylist', { timeout: 10000 }); await p.waitForTimeout(300);
log('⑧ 마이페이지:', (await p.textContent('h1.q')).replace(/\s+/g,' ').trim(),
  '|', (await p.textContent('.sub')).trim());
log('   목록:', (await p.$$eval('.myitem h3', e => e.map(x => x.textContent.replace(/\s+/g,' ').trim()))).join(' / '));
log('   별점 줄:', (await p.textContent('.mystars')).replace(/\s+/g,' ').trim());
log('   폐업 뱃지:', await p.locator('.myitem .badge.bad').count());
/* 고치기 → 기존 값이 채워져 있나 */
await p.click('[data-edit="900001"]'); await p.waitForSelector('.myform form.rate'); await p.waitForTimeout(200);
log('   고치기 폼 — 눌린 별:', await p.locator('.myform .star[aria-pressed=true]').count(),
  '| 코멘트:', JSON.stringify(await p.inputValue('.myform textarea')));
await p.click('.myform .star[data-v="3"]');
await p.fill('.myform textarea', '다시 가보니 보통');
await p.click('.myform [type=submit]'); await p.waitForTimeout(900);
const sent = seen.rate[seen.rate.length - 1];
log('   수정 전송:', JSON.stringify({ kakaoId: sent.kakaoId, score: sent.score, text: sent.text }));
log('   화면 반영:', (await p.textContent('.mystars')).replace(/\s+/g,' ').trim());
/* 지우기 */
await p.click('[data-del="900003"]'); await p.waitForTimeout(700);
log('   지운 뒤 목록:', (await p.$$eval('.myitem h3', e => e.map(x => x.textContent.trim()))).join(' / ') || '(없음)');
log('   remove 호출:', JSON.stringify(myCalls.filter(c => c.remove).map(c => c.remove)));

/* ── 4. 세션 만료 ──────────────────────────── */
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('hoesik.session')); s.exp = Math.floor(Date.now() / 1000) - 10;
  localStorage.setItem('hoesik.session', JSON.stringify(s)); });
await p.goto('https://www.hoesikgak.com/#/'); await p.waitForTimeout(500);
log('⑤ 만료되면 다시 로그인 화면:', await p.locator('#kakaoLogin').count() === 1);

log('ERRORS:', errs.length ? errs : 'none');
await b.close();
