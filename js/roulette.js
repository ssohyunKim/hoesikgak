/* 룰렛. 칸 크기는 모두 같다. 색은 CSS 변수 --wheel-1 … --wheel-6, --wheel-ink, --wheel-line 에서 읽는다 */
import { unesc } from "./util.js";

function palette(canvas) {
  const cs = getComputedStyle(canvas);
  const v = k => cs.getPropertyValue(k).trim();
  return { fills: [1, 2, 3, 4, 5, 6].map(i => v(`--wheel-${i}`) || "#888"),
    ink: v("--wheel-ink") || "#111", line: v("--wheel-line") || "#111", hub: v("--wheel-hub") || "#111", hubInk: v("--wheel-hub-ink") || "#fff" };
}

export function drawWheel(canvas, items, rot = -Math.PI / 2) {
  const ctx = canvas.getContext("2d"), R = canvas.width / 2, n = items.length, c = palette(canvas);
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
    ctx.textAlign = "right"; ctx.fillStyle = c.ink; ctx.font = font(800, 30);
    let nm = unesc(items[i].name); if (nm.length > 7) nm = nm.slice(0, 7) + "…";
    ctx.fillText(nm, R - 34, 10);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(R, R, 58, 0, 7); ctx.fillStyle = c.hub; ctx.fill();
  ctx.fillStyle = c.hubInk; ctx.font = font(800, 28); ctx.textAlign = "center"; ctx.fillText("회식각", R, R + 10);
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
