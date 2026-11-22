/* 화면 흐름 테스트 (Playwright). 카카오 지도·공유 SDK, 시트, 폼은 이 폴더의 가짜로 대신한다.
   실행: npm i -D playwright && node tests/e2e/flow.mjs 390 19   (폭, 가상의 현재 시각)
   SHOTS=폴더 를 주면 화면을 캡처한다 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url)), ROOT=join(HERE,'..','..');
const exe=process.env.PW_CHROME||undefined;   // 설치된 Playwright 브라우저를 쓰려면 비워둔다
const W=+(process.argv[2]||390), HOUR=process.argv[3]||'19';
const b=await chromium.launch({executablePath:exe});
const ctx=await b.newContext({viewport:{width:W,height:860},geolocation:{latitude:37.4995,longitude:126.9206},permissions:['geolocation']});
const p=await ctx.newPage();
const errs=[], posts=[];
p.on('pageerror',e=>errs.push('PAGEERR '+e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
const CT={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
await p.route('https://www.hoesikgak.com/**',r=>{ let path=new URL(r.request().url()).pathname; if(path==='/') path='/index.html';
  const f=join(ROOT,path); if(!existsSync(f)) return r.fulfill({status:404,body:''});
  let body=readFileSync(f);
  // 이 테스트는 로그인·D1 이전의 시트 경로를 본다. 로그인 경로는 login.mjs 가 맡는다
  if(path==='/js/config.js') body=String(body).replace(/API_BASE:\s*"[^"]*"/,'API_BASE: ""');
  r.fulfill({body,contentType:CT[extname(f)]||'application/octet-stream'}); });
await p.route('https://dapi.kakao.com/**',r=>r.fulfill({body:readFileSync(join(HERE,'kmaps.js')),contentType:'text/javascript'}));
await p.route('https://t1.kakaocdn.net/**',r=>r.fulfill({body:readFileSync(join(HERE,'kshare.js')),contentType:'text/javascript'}));
await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'',contentType:'text/css'}));
await p.route('https://docs.google.com/spreadsheets/**',r=>{ const u=decodeURIComponent(r.request().url());
  r.fulfill({body:readFileSync(join(HERE,u.includes('sheet=평가')?'rating.csv':'legacy.csv'),'utf8'),contentType:'text/csv'}); });
await p.route('https://docs.google.com/forms/**',r=>{ posts.push(new URLSearchParams(r.request().postData())); r.fulfill({body:'ok'}); });
// 기준 위치는 사용자가 직접 등록한다. 이미 등록해 둔 사람으로 시작한다
await p.addInitScript(()=>{ try{ localStorage.setItem('hoesik.myplace',
  JSON.stringify({name:'우리 회사',addr:'서울 관악구 보라매로5길 1',lat:37.4993,lng:126.9203})); }catch(e){} });
// 시각 고정 (테마·점심/저녁)
await p.addInitScript(h=>{ const D=Date; const fix=new D(2026,10,20,+h,0).getTime(); const off=fix-D.now();
  class FD extends D{ constructor(...a){ a.length?super(...a):super(D.now()+off);} static now(){ return D.now()+off; } }
  window.Date=FD; }, HOUR);
// SRI 는 스텁이라 맞지 않는다 → integrity 무시
await p.addInitScript(()=>{ const d=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'integrity'); Object.defineProperty(HTMLScriptElement.prototype,'integrity',{set(){},get(){return ''}}); });

const OUT=process.env.SHOTS; const shot=n=>OUT?p.screenshot({path:`${OUT}/s-${W}-${HOUR}-${n}.png`}):null;
const log=(...a)=>console.log(...a);
await p.goto('https://www.hoesikgak.com/'); await p.waitForTimeout(600);
log('theme:',await p.evaluate(()=>document.documentElement.dataset.theme),'| title:',(await p.textContent('h1.q')).trim());
log('sits:',(await p.$$eval('.sit b',e=>e.map(x=>x.textContent))).join(','));
await shot('1home');
// 흐름 1
await p.click(+HOUR<17?'[data-sit="newbie-lunch"]':'[data-sit="team"]'); await p.waitForTimeout(200);
log('setup n:',await p.textContent('#n'),'| budget pressed:',await p.textContent('#budgets [aria-pressed=true]'));
await shot('2setup');
await p.click('#next'); await p.waitForSelector('.pc',{timeout:15000}); await p.waitForTimeout(300);
const names=await p.$$eval('.pc h3',e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
log('picks:',names.length,'|',names.slice(0,9).join(' / '));
log('xss present?',await p.evaluate(()=>!!document.querySelector('#view script')), '| has escaped:', names.some(n=>n.includes('<script>')));
log('dock:',(await p.textContent('.dock')).replace(/\s+/g,' ').trim());
log('예산 추정 표시:',(await p.$$eval('.pc .guess',e=>e.map(x=>x.textContent.trim()))).slice(0,3).join(' / ')||'(없음)');
log('실제 예산 표시:',(await p.$$eval('.pc .meta span',e=>e.map(x=>x.textContent.trim()).filter(t=>t.startsWith('인당')))).slice(0,2).join(' / ')||'(없음)');
await shot('3picks');
await p.locator('.pc .x').nth(1).click(); await p.waitForSelector('.pc'); await p.waitForTimeout(300);
log('after x hash:',decodeURIComponent(await p.evaluate(()=>location.hash)));
if(W<900){ await p.click('[data-m="map"]'); await p.waitForTimeout(300); log('map pins:',await p.locator('#mapBox .pin').count()); await shot('4map'); await p.click('[data-m="list"]'); }
await p.click('#spin'); await p.waitForSelector('#wheel'); await shot('5wheel');
await p.click('#go'); await p.waitForSelector('.result',{timeout:8000});
log('winner:',(await p.textContent('.result .win')).trim(),'| meta:',(await p.textContent('.result .meta')).trim());
await shot('6result');
await p.click('#share'); await p.waitForTimeout(2000);   // 이미지 생성 → 공유 시도 → 폴백까지 // 결과 이미지가 실제로 만들어지나 (공유 경로와 별개로 캔버스 자체를 검사)
log('결과 이미지:',await p.evaluate(async()=>{ const m=await import('./js/roulette.js');
  const items=[{name:'가'},{name:'나'},{name:'다'}];
  const cv=m.resultCanvas(items,-Math.PI/2,items[0]);
  const d=cv.toDataURL('image/png');
  return cv.width+'x'+cv.height+' · '+Math.round(d.length/1024)+'KB · png:'+d.startsWith('data:image/png'); }));
log('업로드된 파일 수:',await p.evaluate(()=>window.__uploaded));
log('shared type:',await p.evaluate(()=>window.__shared&&window.__shared.objectType),'| 링크:',await p.evaluate(()=>{const s=window.__shared;const l=s&&((s.content&&s.content.link)||s.link);return (l&&l.webUrl||'(공유 안 됨)').replace('https://www.hoesikgak.com','');}),
  '| 썸네일:',await p.evaluate(()=>{const s=window.__shared;return (s&&s.content&&s.content.imageUrl||'(없음)').split('/').pop();}));
await p.click('#detail'); await p.waitForTimeout(400); log('sheet over stage:',await p.locator('#sheet.on').count()); await shot('7sheet');
await p.keyboard.press('Escape');
// 흐름 2: 다음 날 카드
await p.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('hoesik.lastSpin')); s.t-=4*3600e3; localStorage.setItem('hoesik.lastSpin',JSON.stringify(s)); });
await p.goto('https://www.hoesikgak.com/#/'); await p.waitForTimeout(800);
log('due card:',await p.locator('#due').count(), (await p.textContent('#due h3').catch(()=>'')));
await shot('8due');
// 어땠어요? 카드가 예산·룸·주차·소음을 같이 묻는가
log('due 질문들:',(await p.$$eval('#due .rrow span:first-child',e=>e.map(x=>x.textContent.trim()))).join(' / '));
await p.click('#due .star[data-v="4"]');
await p.click('#due .chip[data-k="budget"][data-v="40000"]');
await p.click('#due .chip[data-k="room"][data-v="있음"]');
await p.fill('#due textarea','팀 회식 딱 좋음'); await p.click('#due [type=submit]'); await p.waitForTimeout(600);
log('post1 별점/예산/룸:',posts[0]&&posts[0].get('entry.1586533610'),posts[0]&&posts[0].get('entry.240415988'),posts[0]&&posts[0].get('entry.1548194720'),'| due gone:',await p.locator('#due').count()===0);
// 흐름 3: 지도 탐색 → 비추 필터 → 상세 평가
await p.click('#mapBtn'); await p.waitForSelector('#filters',{timeout:15000}); await p.waitForTimeout(400);
log('filters:',(await p.textContent('#filters')).replace(/\s+/g,' ').trim());
await shot('9explore');
await p.click('[data-f="bad"]'); log('bad list:',(await p.$$eval('#list .pc h3',e=>e.map(x=>x.textContent.trim()))).join(','));
// 가게 이름으로 찾기
await p.click('[data-f="all"]'); await p.waitForTimeout(200);
await p.fill('#q','친구네정육식당'); await p.press('#q','Enter'); await p.waitForTimeout(900);
log('search:',(await p.textContent('#foundbar')).replace(/\s+/g,' ').trim(),
  '| 결과:',(await p.$$eval('#list .pc h3',e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()))).slice(0,3).join(' / '),
  '| 필터 숨김:',await p.locator('#filters').isHidden());
log('search 평점 붙었나:',(await p.textContent('#list .pc')).includes('★')||(await p.textContent('#list .pc')).includes('평가 없음'));
await p.click('#clearq'); await p.waitForTimeout(400);
log('검색 지움 → 필터 복귀:',!await p.locator('#filters').isHidden(),'| 목록:',await p.locator('#list .pc').count(),'곳');
await p.click('[data-f="new"]'); await p.locator('#list .pc').first().click(); await p.waitForTimeout(300);
await p.click('#rateBox .star[data-v="5"]'); await p.click('#rateBox [type=submit]'); await p.waitForTimeout(900);
log('post2 별점:',posts[1]&&posts[1].get('entry.1586533610'),'| sheet reopened as rated:',(await p.textContent('#sheet').catch(()=>'')).includes('사내 별점'));
await shot('10rated');
await p.keyboard.press('Escape');
// 폐업 신고: 다른 사람 1명이 이미 신고한 근처가게3 → 내가 신고하면 사라진다
p.on('dialog',d=>d.accept());
await p.click('[data-f="all"]'); await p.waitForTimeout(200);
const before=(await p.$$eval('#list .pc h3',e=>e.map(x=>x.textContent.trim()))).some(t=>t.startsWith('근처가게3'));
await p.locator('#list .pc',{hasText:'근처가게3'}).first().click(); await p.waitForTimeout(300);
await p.click('#shClosed'); await p.waitForTimeout(900);
const after=(await p.$$eval('#list .pc h3',e=>e.map(x=>x.textContent.trim()))).some(t=>t.startsWith('근처가게3'));
log('closed report:',before,'→',after,'| post 한줄평:',posts.at(-1)&&posts.at(-1).get('entry.134488005'));
// 테마 토글, 내 위치
await p.click('#themeBtn'); log('theme toggled:',await p.evaluate(()=>document.documentElement.dataset.theme));
await p.click('[data-at="me"]'); await p.waitForTimeout(800); log('me title:',(await p.textContent('.phead h2')).trim());
// 새로고침 후 대기 평가 유지
await p.goto('https://www.hoesikgak.com/#/map?at=%EB%B3%B4%EB%9D%BC%EB%A7%A4'); await p.waitForSelector('#filters',{timeout:15000});
log('after reload filters:',(await p.textContent('#filters')).replace(/\s+/g,' ').trim());
log('ERRORS:',errs.length?errs:'none');
await b.close();
