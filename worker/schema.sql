-- 회식각 D1 스키마
--   만들기:   npx wrangler d1 create hoesikgak
--   적용:     npx wrangler d1 execute hoesikgak --remote --file=./schema.sql
--   로컬:     npx wrangler d1 execute hoesikgak --local  --file=./schema.sql
--
-- 시트와 달리 가게 정보와 평가를 나눈다. 가게 정보가 평가마다 중복되지 않는다.

CREATE TABLE IF NOT EXISTS places (
  kakao_id TEXT PRIMARY KEY,          -- 카카오 장소 ID. 가게를 가리키는 유일한 값
  name     TEXT NOT NULL,
  cat      TEXT,                      -- 회식각 분류 (고기/한식/…)
  kcat     TEXT,                      -- 카카오 원본 분류
  addr     TEXT,
  lat      REAL NOT NULL,
  lng      REAL NOT NULL
);
-- 기준 위치 반경으로 자를 때 쓴다
CREATE INDEX IF NOT EXISTS idx_places_geo ON places (lat, lng);

CREATE TABLE IF NOT EXISTS ratings (
  kakao_id   TEXT NOT NULL,
  author     TEXT NOT NULL,           -- k_… (카카오 회원번호를 HMAC 한 값)
  score      INTEGER,                 -- 0~5. NULL 이면 별점 없이 폐업만 신고한 것
  budget     INTEGER,
  room       TEXT, parking TEXT, noise TEXT, fit TEXT,
  text       TEXT,
  closed     INTEGER NOT NULL DEFAULT 0,   -- 1 이면 "문 닫았어요" 신고
  req_id     TEXT,
  created_at INTEGER NOT NULL,
  -- 한 사람이 한 가게에 한 줄. 다시 남기면 덮어쓴다
  PRIMARY KEY (kakao_id, author)
);
-- 탈퇴로 지울 때, 그리고 도배를 막을 때 쓴다
CREATE INDEX IF NOT EXISTS idx_ratings_author ON ratings (author, created_at);

-- ── 투표방 ────────────────────────────────────────────
-- 방을 만들 때 후보를 고정한다. 기준 위치가 사람마다 달라서
-- 조건만 넘기면 여는 사람마다 다른 목록을 보게 된다.
CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,        -- 공유 주소에 들어가는 짧은 값
  owner      TEXT NOT NULL,           -- 만든 사람 uid
  title      TEXT,                    -- "팀 회식 · 8명 · 3~5만" 같은 요약
  base_name  TEXT,
  base_lat   REAL, base_lng REAL,
  picks      TEXT NOT NULL,           -- JSON: [{kakaoId,name,cat,score,budget,dist}]
  closed     INTEGER NOT NULL DEFAULT 0,
  winner     TEXT,                    -- 룰렛으로 정해진 카카오ID
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms (owner, created_at);

CREATE TABLE IF NOT EXISTS votes (
  room_id    TEXT NOT NULL,
  voter      TEXT NOT NULL,
  kakao_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 1인 1표. 다시 누르면 바뀐다
  PRIMARY KEY (room_id, voter)
);
CREATE INDEX IF NOT EXISTS idx_votes_room ON votes (room_id);
