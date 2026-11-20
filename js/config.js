/* 회식각 설정. 값만 바꾸면 되도록 여기 모아둔다 */
export const CONFIG = {
  SITE_URL: "https://www.hoesikgak.com/",

  /* 구글 시트. 평가 탭은 별점 폼(tools/rating-form.md)의 응답 탭이다 */
  SHEET_ID: "1bUq5KJ-nG5P-e7ES5xT06Yzxm7TALLIJpwFCYDgUWiM",
  RATING_SHEET: "평가",
  LEGACY_SHEET: "설문지 응답 시트1",   // 옛 등록 폼. 평가 탭으로 이관하면 더 안 읽는다

  /* 별점 폼의 "미리 채워진 링크" — 각 칸에 질문 이름을 그대로 적어 만든 것 */
  RATE_FORM: "https://docs.google.com/forms/d/e/1FAIpQLScijsTtuJGWwL3OvHnxBuPdcBRyZTUFDrCPhxtRtOllJyKrcQ/viewform?usp=pp_url&entry.989536997=%EC%B9%B4%EC%B9%B4%EC%98%A4ID&entry.7482158=%EB%A7%A4%EC%9E%A5%EB%AA%85&entry.143308170=%EC%97%85%EC%A2%85&entry.1256497789=%EC%B9%B4%EC%B9%B4%EC%98%A4%EB%B6%84%EB%A5%98&entry.494993945=%EC%A3%BC%EC%86%8C&entry.1261599131=%EC%9C%84%EB%8F%84&entry.187366367=%EA%B2%BD%EB%8F%84&entry.1586533610=%EB%B3%84%EC%A0%90&entry.240415988=%EC%9D%B8%EB%8B%B9%EC%98%88%EC%82%B0&entry.1548194720=%EB%A3%B8&entry.657376056=%EC%A3%BC%EC%B0%A8&entry.87630442=%EC%86%8C%EC%9D%8C&entry.1208226963=%EC%A0%81%EC%A0%95%EC%9D%B8%EC%9B%90&entry.134488005=%ED%95%9C%EC%A4%84%ED%8F%89&entry.483133536=%EC%9E%91%EC%84%B1%EC%9E%90&entry.430222415=%EA%B8%B0%EC%A4%80&entry.1175260167=%EC%9A%94%EC%B2%ADID",

  /* 카카오 JavaScript 키. 콘솔에 사이트 도메인이 등록돼 있어야 지도가 뜬다 */
  KAKAO_KEY: "20002404caeec65787ea2d0c19935431",
  KAKAO_SHARE: true,

  /* key 는 시트의 "사옥/기준" 값과 같아야 한다. lat/lng 는 주소를 못 찾을 때 쓰는 대략값 */
  OFFICES: [
    { key: "보라매", name: "보라매사옥", addr: "서울 관악구 보라매로5길 1", lat: 37.4993, lng: 126.9203 },
    { key: "마포", name: "마포사옥", addr: "서울 마포구 마포대로 144", lat: 37.5443, lng: 126.9515 },
  ],
  DEFAULT_OFFICE: "보라매",

  NEAR_RADIUS: 1500,    // 기준 위치에서 이 거리(m) 안만 후보
  LEGACY_RADIUS: 6000,  // 옛 데이터(이름만 있음)를 이름으로 찾을 반경
  ROULETTE_MIN: 3,      // 평균 별점이 이 이상이어야 룰렛에 오른다
  MIN_GOOD: 6,          // 좋은 후보가 이보다 적으면 🆕 평가 없는 곳으로 채운다
  MIN_PICKS: 8,         // 채울 때 목표 개수
  WHEEL_MAX: 8,         // 룰렛 칸 수 상한
  CLOSED_REPORTS: 2,    // "문 닫았어요" 신고가 서로 다른 사람에게서 이만큼 모이면 자동으로 숨긴다

  MARQUEE: ["못 정하면 돌려", "룸 없는데 12명 데려가지 마", "인당 예산 먼저 찍어",
    "데인 집은 비추로 올려", "문 닫은 집은 알려줘", "2차는 걸어서 3분"]
};
