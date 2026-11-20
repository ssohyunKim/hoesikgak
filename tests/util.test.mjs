import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, unesc, distOf, fmtDist, won } from "../js/util.js";

test("esc / unesc", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  const s = `<b>"회식" & '각'</b>`;
  assert.equal(unesc(esc(s)), s);
  assert.equal(esc(null), "");
});

test("distOf", () => {
  assert.equal(distOf(37.5, 127, 37.5, 127), 0);
  const d = distOf(37.4993, 126.9203, 37.5443, 126.9515);
  assert.ok(d > 5000 && d < 6000, String(d));
});

test("fmtDist / won", () => {
  assert.equal(fmtDist(340), "340m");
  assert.equal(fmtDist(1530), "1.5km");
  assert.equal(won(42000), "42,000");
});
