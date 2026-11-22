/* 룰렛. 칸 크기는 모두 같다. 색은 CSS 변수 --wheel-1 … --wheel-6, --wheel-ink, --wheel-line 에서 읽는다 */
import { unesc } from "./util.js";

function palette(canvas) {
  const cs = getComputedStyle(canvas);
  const v = k => cs.getPropertyValue(k).trim();
  return { fills: [1, 2, 3, 4, 5, 6].map(i => v(`--wheel-${i}`) || "#888"),
    ink: v("--wheel-ink") || "#111", line: v("--wheel-line") || "#111", hub: v("--wheel-hub") || "#111", hubInk: v("--wheel-hub-ink") || "#fff" };
}

export function drawWheel(canvas, items, rot = -Math.PI / 2) {
  drawWheelOn(canvas, items, rot, palette(canvas));
}
/* 색을 넘겨받는 쪽. 화면 밖 캔버스는 CSS 변수를 못 읽어서 분리했다 */
function drawWheelOn(canvas, items, rot, c) {
  const ctx = canvas.getContext("2d"), R = canvas.width / 2, n = items.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const font = (w, px) => `${w} ${px}px 'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif`;
  if (!n) return;
  const seg = 2 * Math.PI / n;
  for (let i = 0; i < n; i++) {
    const a = i * seg + rot;
    ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R - 8, a, a + seg); ctx.closePath();
    ctx.fillStyle = c.fills[i % c.fills.length]; ctx.fill();
    ctx.strokeStyle = c.line; ctx.lineWidth = 4; ctx.stroke();
    ctx.save(); ctx.translate(R, R); ctx.rotate(a + seg / 2);
    /* 왼쪽 절반은 그대로 두면 글자가 거꾸로 선다. 180° 돌려 바로 세운다 */
    const mid = ((a + seg / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const flip = mid > Math.PI / 2 && mid < Math.PI * 1.5;
    if (flip) ctx.rotate(Math.PI);
    ctx.textAlign = flip ? "left" : "right"; ctx.fillStyle = c.ink; ctx.font = font(800, 30);
    let nm = unesc(items[i].name); if (nm.length > 7) nm = nm.slice(0, 7) + "…";
    ctx.fillText(nm, flip ? -(R - 34) : R - 34, 10);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(R, R, 58, 0, 7); ctx.fillStyle = c.hub; ctx.fill();
  ctx.fillStyle = c.hubInk; ctx.font = font(800, 28); ctx.textAlign = "center"; ctx.fillText("회식각", R, R + 10);
}

/* ── 공유용 결과 이미지 ──────────────────────
   돌아간 그대로의 캔버스는 바늘도 없고 이름도 작아서 채팅방에서 안 읽힌다.
   룰렛 + 바늘 + 당첨 이름을 한 장으로 다시 그린다. 색은 보고 있는 테마를 따른다 */
export function resultCanvas(items, rot, winner, { w = 800, h = 860 } = {}) {
  /* --wheel-* 는 .night 안에서만 정의된다 (룰렛 무대는 낮에도 밤 색을 쓴다).
     그래서 색을 읽을 때도 .night 안에 붙여야 한다 */
  const stage = document.createElement("div");
  stage.className = "night";
  stage.style.cssText = "position:absolute;left:-9999px;top:0";
  const ref = document.createElement("canvas");
  stage.appendChild(ref);
  document.body.appendChild(stage);
  const c = palette(ref);
  const cs = getComputedStyle(stage);
  const bg = cs.getPropertyValue("--bg").trim() || "#14161C";
  const fg = cs.getPropertyValue("--text").trim() || "#F1EDE4";
  stage.remove();

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d");
  const font = (we, px) => `${we} ${px}px 'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif`;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  /* 룰렛을 위쪽에 그린다 */
  const size = Math.round(w * 0.72), top = Math.round(h * 0.06);
  const wheel = document.createElement("canvas");
  wheel.width = wheel.height = size;
  drawWheelOn(wheel, items, rot, c);
  ctx.drawImage(wheel, (w - size) / 2, top);

  /* 바늘 — 화면에서는 CSS 삼각형이라 캔버스에 따로 그려야 한다 */
  const cx = w / 2, ny = top - 2;
  ctx.beginPath(); ctx.moveTo(cx - 20, ny); ctx.lineTo(cx + 20, ny); ctx.lineTo(cx, ny + 42);
  ctx.closePath(); ctx.fillStyle = c.fills[0]; ctx.fill();

  /* 당첨 이름 */
  ctx.textAlign = "center";
  ctx.fillStyle = c.fills[0];
  ctx.font = font(800, 30);
  ctx.fillText("🎡 룰렛이 정했어요", cx, top + size + 56);
  ctx.fillStyle = fg;
  ctx.font = font(800, 54);
  let nm = unesc(winner.name);
  while (ctx.measureText(nm).width > w - 80 && nm.length > 4) nm = nm.slice(0, -1);
  if (nm !== unesc(winner.name)) nm += "…";
  ctx.fillText(nm, cx, top + size + 118);
  ctx.font = font(700, 26);
  ctx.globalAlpha = .6;
  ctx.fillText("회식각", cx, h - 28);
  ctx.globalAlpha = 1;
  return out;
}
const toBlob = cv => new Promise(r => cv.toBlob(r, "image/png"));
export async function resultImageFile(items, rot, winner) {
  const blob = await toBlob(resultCanvas(items, rot, winner));
  return blob ? new File([blob], "hoesikgak.png", { type: "image/png" }) : null;
}

/* 무작위로 한 칸을 고르고 4초 감속하며 그 칸에 멈춘다. 고른 index 를 돌려준다 */
export function spinWheel(canvas, items, from = -Math.PI / 2) {
  const n = items.length, seg = 2 * Math.PI / n, w = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * seg * 0.7;
  const to = -Math.PI / 2 - (w * seg + seg / 2) + jitter + 2 * Math.PI * (5 + Math.floor(Math.random() * 3));
  return new Promise(resolve => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { drawWheel(canvas, items, to); return resolve({ index: w, rot: to }); }
    const t0 = performance.now(), dur = 4000;
    (function frame(t) {
      const k = Math.min(1, (t - t0) / dur), rot = from + (to - from) * (1 - Math.pow(1 - k, 4));
      drawWheel(canvas, items, rot);
      if (k < 1) requestAnimationFrame(frame); else resolve({ index: w, rot: to });
    })(t0);
  });
}
