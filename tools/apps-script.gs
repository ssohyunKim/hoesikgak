/* ═══════════════════════════════════════════════════
   회식각 시트 쓰기 — 구글 시트에 붙이는 Apps Script

   두 가지 방식으로 받는다.
   - 익명 모드 (지금): 사이트가 바로 부른다. index.html CONFIG.RATE_URL 에 이 웹 앱 주소를 넣는다.
     작성자는 브라우저마다 만든 익명 ID(u…). 평가 추가만 된다.
   - 로그인 모드 (나중에): 카카오 로그인을 확인한 Cloudflare Worker(worker/)만 부른다.
     공유 비밀값(SHEET_SECRET)이 맞아야 하고, 평가 추가와 작성자 삭제(웹훅)가 된다.
     익명 모드를 끄려면 스크립트 속성 ANON_RATE = off 를 넣는다.

   설치 (한 번만)
   1. 회식각 구글 시트 → 확장 프로그램 → Apps Script → 이 파일 내용을 붙여넣고 저장
   2. (로그인 모드일 때만) 프로젝트 설정(톱니바퀴) → 스크립트 속성 → 속성 추가
        이름 SHEET_SECRET / 값: 긴 무작위 문자열 (Worker 의 SHEET_SECRET 과 같게)
   3. 배포 → 새 배포 → 유형 "웹 앱", 실행 사용자: 나, 액세스 권한: 모든 사용자
   4. 나온 …/exec 주소를 익명 모드면 CONFIG.RATE_URL 에, 로그인 모드면 Worker 비밀값 SHEET_URL 로 넣는다
   코드를 고치면 배포 → 배포 관리 → 수정 → 버전 "새 버전" 으로 다시 배포해야 반영된다.

   요청 (JSON)
     {secret, action:"rate",   author, kakaoId, score, ...}  → "평가" 탭에 한 줄 추가
     {secret, action:"forget", author, reason}               → 그 작성자의 행을 전부 지운다
                                                              (카카오 연결 끊기·탈퇴 웹훅)
   ═══════════════════════════════════════════════════ */
const SHEET = "평가";
const HEAD = ["타임스탬프", "카카오ID", "매장명", "업종", "카카오분류", "주소", "위도", "경도",
  "별점", "인당예산", "룸", "주차", "소음", "적정인원", "한줄평", "작성자", "기준", "검증", "영업상태", "요청ID"];
const PER_HOUR = 40;   // 한 사람이 한 시간에 남길 수 있는 평가 수

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse((e.postData && e.postData.contents) || "{}");
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty("SHEET_SECRET");
    const author = String(d.author || "");
    if (secret && d.secret === secret) {                       // Worker (로그인 모드)
      if (!/^k_[0-9a-f]{24}$/.test(author)) return out({ ok: false, error: "author" });
      if (d.action === "rate") return rate(d, author);
      if (d.action === "forget") return forget(author, d.reason);
      return out({ ok: false, error: "action" });
    }
    if (props.getProperty("ANON_RATE") === "off") return out({ ok: false, error: "forbidden" });
    if (d.action !== "rate" || !/^u[0-9a-z]{8,40}$/.test(author)) return out({ ok: false, error: "forbidden" });
    return rate(d, author);                                    // 사이트 (익명 모드)
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function rate(d, author) {
  const id = String(d.kakaoId || "").replace(/\D/g, "");
  const score = Number(d.score);
  if (!id || !(score >= 0 && score <= 5)) return out({ ok: false, error: "kakaoId 또는 별점이 잘못됐습니다" });

  const cache = CacheService.getScriptCache(), ck = "n:" + author;
  const n = Number(cache.get(ck) || 0);
  if (n >= PER_HOUR) return out({ ok: false, error: "too_many" });
  cache.put(ck, String(n + 1), 3600);

  sheet().appendRow([
    new Date(), Number(id), clip(d.name, 60), clip(d.cat, 20), clip(d.kcat, 80), clip(d.addr, 120),
    Number(d.lat) || "", Number(d.lng) || "", score, Number(d.budget) || "",
    pickOf(d.room, ["있음", "없음"]), pickOf(d.parking, ["가능", "불가"]),
    pickOf(d.noise, ["조용", "보통", "시끄러움"]),
    pickOf(d.fit, ["4명 이하", "5~8명", "9~12명", "13~20명", "20명 이상"]),
    clip(d.text, 300), author, clip(d.base, 20), "", "", clip(d.reqId, 60)
  ]);
  return out({ ok: true });
}

/* 아래에서부터 지워야 행 번호가 안 밀린다 */
function forget(author, reason) {
  const s = sheet(), col = HEAD.indexOf("작성자") + 1, last = s.getLastRow();
  if (last < 2) return out({ ok: true, deleted: 0 });
  const vals = s.getRange(2, col, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === author) { s.deleteRow(i + 2); deleted++; }
  }
  console.log("forget", author, reason, deleted);
  return out({ ok: true, deleted });
}

/* 배포가 살아 있는지 브라우저로 열어서 확인하는 용도 */
function doGet() { return out({ ok: true, sheet: SHEET }); }

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SHEET);
  if (!s) { s = ss.insertSheet(SHEET); s.appendRow(HEAD); s.setFrozenRows(1); }
  return s;
}
/* "=", "+", "-", "@" 로 시작하면 시트가 수식으로 읽는다. 앞에 ' 를 붙여 글자로 둔다 */
function clip(v, n) {
  const s = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function pickOf(v, allowed) { return allowed.indexOf(String(v)) >= 0 ? String(v) : ""; }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
