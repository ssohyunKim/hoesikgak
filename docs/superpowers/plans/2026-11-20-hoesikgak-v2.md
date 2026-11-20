# 회식각 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 index.html 회식각을 "결정 마법사(상황 → 조건 → 후보 → 룰렛)" 중심의 모듈형 정적 사이트로 다시 만든다. 스펙: `docs/superpowers/specs/2026-11-20-hoesikgak-v2-design.md`

**Architecture:**
- 빌드 없이 ES 모듈로 만든다. 순수 로직(집계·점수·후보·라우터·테마·폼 매핑)과 DOM 코드(views)를 나눈다. 순수 로직은 `node --test`로, 화면 흐름은 Playwright로 검증한다.
- 색은 `css/theme.css`의 CSS 변수에만 둔다. 사용자가 나중에 이 파일만 고쳐서 테마를 바꾼다.

**Tech Stack:**
- Vanilla JS (ES2020 모듈)
- 카카오 지도 JS SDK (services), 카카오 공유 SDK 2.8.0
- 구글 시트 gviz CSV, 구글 폼
- Node 24 `node:test`
- Playwright (scratchpad에 설치된 것)

**실행 메모:** 이 계획은 같은 세션에서 바로 실행한다. 순수 모듈 태스크는 테스트를 먼저 쓴다(TDD). 뷰 태스크는 마지막 Playwright 흐름 테스트로 검증한다.

---

## File Structure

| 파일 | 책임 | 의존 |
|---|---|---|
| `index.html` | 메타·OG, 롤링 배너, 상단 바, `#view`, 시트·토스트 컨테이너 | — |
| `css/theme.css` | `:root[data-theme=day]`, `[data-theme=night]`, `.night` 색 변수 | — |
| `css/base.css` | 레이아웃·컴포넌트 (변수만 사용) | theme.css |
| `js/config.js` | `CONFIG` | — |
| `js/store.js` | `get(k,d)`, `set(k,v)`, `del(k)` — 예외 안전 | localStorage |
| `js/util.js` | `esc`, `unesc`, `distOf`, `fmtDist`, `won`, `T`, `$`, `h` | — |
| `js/data.js` | CSV 파싱, 집계(`aggregate`, `legacyPlaces`, `combine`), `loadPlaces()`, 대기 평가 | util, store, config |
| `js/situations.js` | `SITUATIONS`, `BUDGETS`, `situationOf`, `presetCond`, `score` | — |
| `js/picks.js` | `buildPicks(rated, nearby, cond, sit, cfg)` | situations, util |
| `js/router.js` | `parseHash`, `buildHash` | — |
| `js/theme.js` | `themeFor`, `mealFor`, `applyTheme`, `toggleTheme` | store |
| `js/rating.js` | `parseFormLink`, `formBody`, `reviewDue`, `submitRating`, `rememberSpin`, `rateFormHtml`, `bindRateForm` | store, util, data |
| `js/kakao.js` | `loadMaps`, `geocodeOffices`, `nearby`, `searchPlaces`, `resolveLegacy`, `makeMap`, `setPins` | config, util, data(catOf) |
| `js/share.js` | `toast`, `sharePlace`, `shareSite`, `copyLink` | config |
| `js/roulette.js` | `drawWheel`, `spinWheel` | — |
| `js/views/home.js` · `setup.js` · `picks.js` · `spin.js` · `map.js` · `sheet.js` | 화면 그리기 | 위 모듈 |
| `js/app.js` | 시작, 해시 라우팅, 공유 상태 `ctx` | 전부 |
| `tests/*.test.mjs` | 순수 모듈 단위 테스트 | — |

**Place 모델 (모든 모듈 공통)**
```
{ id, kakaoId, name, cat, kcat, addr, phone, lat, lng,
  rated, score, count, recNo, rec,
  budget, fit:{min,max,label}|null, room:true|false|null, parking:true|false|null, noise,
  reviews:[{txt,bad}], verified, office, isNew, dist }
```
- `id`는 `"k"+kakaoId`, 옛 데이터는 `"L"+n`이다.
- 문자열 필드는 `esc()`를 거친 뒤 저장한다.

**cond (마법사 상태)**
```
{ s:"team", n:8, b:"3050", at:"보라매"|"me", w:["room"], x:["123"] }
```

---

### Task 1: 기반 모듈 (config, store, util)
**Files:** Create `js/config.js`, `js/store.js`, `js/util.js`, `tests/util.test.mjs`

- [ ] 테스트 작성
  - `esc('<a href="x">&\'')` → `&lt;a href=&quot;x&quot;&gt;&amp;&#39;`
  - `unesc(esc(s)) === s`
  - `distOf(37.5,127,37.5,127) === 0`
  - 보라매(37.4993,126.9203)에서 마포(37.5443,126.9515)까지 5000~6000m
  - `fmtDist(340)` → `"340m"`, `fmtDist(1530)` → `"1.5km"`
  - `won(42000)` → `"42,000"`
- [ ] `node --test tests/` → FAIL (모듈 없음)
- [ ] 구현한다. config 값은 현재 index.html CONFIG의 사옥, 시트, 폼 링크, 카카오 키, SITE_URL을 그대로 쓴다. 상수 `NEAR_RADIUS 1500`, `LEGACY_RADIUS 6000`, `ROULETTE_MIN 3`, `MIN_GOOD 6`, `MIN_PICKS 8`, `WHEEL_MAX 8`을 둔다.
- [ ] `node --test tests/` → PASS

### Task 2: data.js — 읽기·집계
**Files:** Create `js/data.js`, `tests/data.test.mjs`

- [ ] 테스트 작성 (지금 index.html의 집계 규칙과 같다)
  - `parseCSV` 따옴표 안 쉼표·줄바꿈, `normHead("3. 인당 예산 (숫자만 예: 30000)") === "인당예산"`
  - `starScore("⭐️⭐️⭐️⭐️")===4`, `starScore("별점도 아깝다")===0`, `starScore("")===null`, `starScore("4.5")===4.5`
  - `parseHead("9~12명")` → `{min:9,max:12}`, `parseHead("4명 이하")` → `{min:2,max:4}`, `parseHead("20명 이상")` → `{min:20,max:99}`, `parseHead("잘 모르겠음")` → `null`
  - `aggregate`
    - 같은 카카오ID에 작성자 A가 2번(3, 5), B가 1번(4)을 남기면 `count 2`, `score 4.5`다 (A는 마지막 행만 센다)
    - `영업상태 "폐업"`인 가게는 빠진다
    - 예산 [25000,40000,70000]이면 중앙값 40000이다
    - 룸 최빈값 "있음"이면 `room true`다
    - 별점 1점 2명, 5점 1명이면 `recNo 2`, 평균 2.33, `rec true`다
    - 별점 1점만 있으면 `rec false`다
    - 매장명 `<b>`는 `&lt;b&gt;`가 된다
  - `legacyPlaces`: 같은 매장명+사옥 2행은 1곳으로 합치고 별점은 평균한다. 좌표는 null이고 `office`는 유지한다.
  - `combine(legacy, agg)`: count와 score를 가중평균하고, 빈 칸은 agg에서 채운다. id는 agg 쪽을 쓴다.
  - `mergePending(rows, pending, now)`: 요청ID가 시트에 있으면 대기에서 빼고, 3일이 넘은 것도 뺀다.
- [ ] FAIL 확인 → 구현
  - `loadPlaces()`는 평가 탭과 옛 시트를 fetch한다.
  - 평가 탭에 `legacy-*` 작성자가 있으면 옛 시트는 무시한다.
  - 반환은 `{places, ok}`다.
- [ ] PASS 확인

### Task 3: situations.js — 상황·점수
**Files:** Create `js/situations.js`, `tests/situations.test.mjs`

- [ ] 테스트 작성
  - `SITUATIONS`는 10개, 키는 스펙 4절과 같다. 점심 4, 저녁 5, 공통 1이다.
  - `BUDGETS` 키는 `any`, `u15`, `u30`, `3050`, `o30`, `o50`이다.
  - `presetCond("team",{at:"보라매"})` → `{s:"team",n:8,b:"3050",at:"보라매",w:[],x:[]}`
  - `presetCond("vip")` → `w`에 room·quiet가 들어가고 `b "o50"`이다.
  - `score`
    - 같은 조건에서 별점 4.5(5명)가 별점 5(1명)보다 높다
    - 예산 밖이면 범위 안보다 20점 이상 낮다
    - `w:["room"]`에서 room true > null > false 순이다
    - `team`에서 cat "고기"가 "일식"보다 8점 높다
    - `quick`에서 거리 300m 차이가 다른 상황보다 3배 크게 반영된다
- [ ] FAIL → 구현 → PASS

### Task 4: picks.js — 후보 만들기
**Files:** Create `js/picks.js`, `tests/picks.test.mjs`

- [ ] 테스트 작성 (cfg = `{NEAR_RADIUS:1500, ROULETTE_MIN:3, MIN_GOOD:6, MIN_PICKS:8, WHEEL_MAX:8}`, base 보라매)
  - 1.5km 밖인 평가 가게는 빠진다
  - `rec false`(비추)는 빠진다
  - `x`에 든 카카오ID는 빠진다
  - 좋은 곳(≥3) 3곳 + 주변 10곳 → `list`는 좋은 3 + 🆕 5 = 8곳 이상이고, 🆕는 가까운 순이며 `isNew true`다
  - 좋은 곳 7곳이면 🆕를 넣지 않는다
  - `team`이면 🆕 중 cat "고기"·"곱창"만 채우고 일식은 채우지 않는다
  - 평균 2.5 가게는 `list` 끝에 `low true`로 있고 `wheel`에는 없다
  - `wheel` 길이는 8 이하다
  - 이미 평가된 카카오ID의 주변 결과는 🆕로 중복되지 않는다
  - 좌표 없는 옛 가게는 `office === at`일 때만 포함한다 (`dist null`)
- [ ] FAIL → 구현 → PASS

### Task 5: router.js · theme.js
**Files:** Create `js/router.js`, `js/theme.js`, `tests/router.test.mjs`, `tests/theme.test.mjs`

- [ ] 테스트 작성
  - `buildHash("picks",{s:"team",n:8,b:"3050",at:"보라매",w:["room"],x:["1","2"]})` → `#/picks?s=team&n=8&b=3050&at=%EB%B3%B4%EB%9D%BC%EB%A7%A4&w=room&x=1,2`
  - 위 값을 `parseHash`하면 `{view:"picks", cond:같은 객체}`로 돌아온다
  - `parseHash("")` → `{view:"home", cond:{}}`
  - `n`이 숫자가 아니면 무시한다
  - `themeFor`: 12:00 → day, 17:00 → night, 04:59 → night, 05:00 → day. 같은 날 저장된 `{theme:"night",day:"2026-11-20"}`이 있으면 night, 다른 날짜면 시간을 따른다.
  - `mealFor`: 11:00 → lunch, 18:00 → dinner
- [ ] FAIL → 구현 → PASS

### Task 6: rating.js 순수 부분
**Files:** Create `js/rating.js`, `tests/rating.test.mjs`

- [ ] 테스트 작성
  - `parseFormLink(미리채움 링크)` → `action`은 `…/formResponse`이고, `entries["카카오ID"]`는 `"entry.989536997"`이다. 카카오ID나 별점이 없으면 `null`이다.
  - `formBody(form, vals)`는 entries에 있는 이름만 넣는다
  - `reviewDue`
    - `{t: now-4h}`면 가게를 반환한다
    - now-1h면 null이다 (3시간 전)
    - now-4일이면 null이다
    - 이미 내 평가에 있으면 null이다
- [ ] FAIL → 구현 (DOM 함수 `rateFormHtml`·`bindRateForm`·`submitRating`도 같은 파일에 둔다) → PASS

### Task 7: kakao.js · share.js · roulette.js (지금 코드 이식)
**Files:** Create `js/kakao.js`, `js/share.js`, `js/roulette.js`

- [ ] `kakao.js`
  - `loadMaps()`는 Promise<boolean>이다. SDK 스크립트를 한 번만 넣는다.
  - `nearby(base)`
    - FD6 카테고리 3페이지와 키워드 7개(고기집, 곱창, 이자카야, 횟집, 중식, 술집, 한식)를 검색한다
    - 제외 분류(카페 등)는 뺀다
    - Place(`isNew true`, `rated false`)로 만든다
    - 기준 위치 key로 캐시한다
  - `searchPlaces(q, base)` 반경 5km
  - `resolveLegacy(places, offices)`는 이름으로 좌표·카카오ID를 찾는다. 등록 사옥 기준 6km, 60ms 간격이다.
  - `makeMap(el, center)`, `setPins(map, pins, fit)`
- [ ] `share.js`는 지금 `withKakao`, `share`, `sharePlace`, `shareSite`, `copyLink`, `toast`를 이식한다. 링크는 `CONFIG.SITE_URL`을 쓴다.
- [ ] `roulette.js`
  - `drawWheel(canvas, items, rot)`는 칸 색을 CSS 변수 `--wheel-1…6`에서 읽는다
  - `spinWheel(canvas, items)`는 Promise<index>, 4초 ease-out이고, 동작 줄이기 설정이면 즉시 멈춘다
- [ ] `node --check`로 문법을 확인한다

### Task 8: CSS 테마·기본
**Files:** Create `css/theme.css`, `css/base.css`

- [ ] `theme.css`
  - day 팔레트 (B): `--bg #FFF8F0`, `--surface #fff`, `--text #2B1D14`, `--muted #9A8F84`, `--accent #FF6B2C`, `--accent-ink #fff`, `--line #F0E4D8`, `--shadow`, `--bad #E0483E`, `--good #2F9E6B`
  - night 팔레트 (C): `--bg #14161C`, `--surface #1F222B`, `--text #F1EDE4`, `--muted #8C8F99`, `--accent #FFC94D`, `--accent-ink #14161C`, `--line #2E323D`
  - `.night` 클래스는 night 변수를 강제한다 (룰렛 무대용)
  - `--wheel-1…6`, `--radius 16px`
- [ ] `base.css`: 상단 바, 롤링 배너, `.wrap`(최대 560px), 상황 그리드, 칩, 스테퍼, 카드, 하단 고정 바, 시트(바텀시트·데스크톱 우측 패널), 지도 화면, 룰렛 무대, 토스트, 다음 날 카드. 색 리터럴 없이 변수만 쓴다.

### Task 9: index.html · app.js · 홈·조건 화면
**Files:** Replace `index.html`; Create `js/app.js`, `js/views/home.js`, `js/views/setup.js`

- [ ] `index.html`: OG 메타는 그대로 두고, 배너·상단 바(로고, 🗺, ☀️/🌙)·`<main id="view">`·`#sheet`·`#toast`를 둔다. `<script type="module" src="js/app.js">`
- [ ] `app.js`
  - `ctx = {cond, places:Promise, base(), nearby(), go(view,cond), openSheet(p)}`
  - `hashchange`에서 렌더한다
  - 시작할 때 `applyTheme`, `loadPlaces`, `loadMaps`를 부르고, 지오코딩 후 `resolveLegacy`를 부른다
  - `base()`는 사옥 객체를 주거나, `"me"`면 위치를 요청하고 실패하면 기본 사옥으로 돌아가며 토스트를 띄운다
- [ ] `home.js`: 다음 날 카드(`reviewDue`), `mealFor` 세트, 전환 링크. 상황을 누르면 `go("setup", presetCond(s,{at}))`
- [ ] `setup.js`: 인원 스테퍼(1~40, "상관없음" 포함), 예산 칩, 기준 위치(사옥들 + 내 위치), 있으면 좋은 조건 칩. "후보 보기" → `go("picks", cond)`

### Task 10: 후보·지도·상세 화면
**Files:** Create `js/views/picks.js`, `js/views/map.js`, `js/views/sheet.js`

- [ ] `picks.js`
  - 로딩 → `buildPicks`
  - 목록/지도 토글
  - 카드: 이름, 업종, 별점(n명), 거리, 예산, 🆕, 낮은 점수 표시, ✕ 빼기(`x`에 추가해서 다시 렌더)
  - 하단 고정 바: 🎡(wheel<2면 "조건 넓히기"), 🗳 비활성
- [ ] `map.js`: 기준 위치 칩, 필터(전체·추천·비추·평가 없음), 별점 색 핀, 하단 목록, 카드를 누르면 상세
- [ ] `sheet.js`: 정보와 별점 폼(`rateFormHtml`/`bindRateForm`), 카카오맵 링크, 전화, 위치 공유. 모바일은 바텀시트, 데스크톱은 우측 패널. Esc·배경을 누르면 닫는다.

### Task 11: 룰렛 화면
**Files:** Create `js/views/spin.js`

- [ ] `.night` 무대
  - 캔버스와 "돌리기" 버튼
  - 결과 카드: 이름, 별점, 거리, 예산, 첫 한줄평, 🆕 배지
  - 버튼: 💬 공유, 📞 전화, 🗺 지도(상세), 🔁 다시, ✕ 빼고 다시(`x`에 추가하고 다시 휠)
  - 결과가 나오면 `rememberSpin(place)`

### Task 12: 흐름 테스트·정리·커밋
**Files:** Create `tests/e2e.mjs` (scratchpad의 Playwright 사용, 실행은 scratchpad에서)

- [ ] 카카오 지도·공유 SDK 스텁, 시트 CSV 스텁(평가 탭 6행 + 옛 시트), 폼 POST 캡처
- [ ] 흐름 1 (390px / 1280px)
  - 홈 → 저녁 세트 → 🍻 → 조건(n 8, 3~5만 선택 상태 확인) → 후보(🆕 포함, ✕ 하나) → 지도 토글 → 🎡 → 결과 → 공유 클릭
- [ ] 흐름 2: `lastSpin`을 4시간 전으로 넣고 홈 → 다음 날 카드 → ★4 → 폼 POST 확인
- [ ] 흐름 3: 🗺 → 핀 목록 → 상세 → 별점 5 → POST
- [ ] 콘솔 오류 0, 스크린샷을 눈으로 확인
- [ ] `node --test tests/` 전체 PASS → 커밋
