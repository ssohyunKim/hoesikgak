import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormLink, formBody, reviewDue } from "../js/rating.js";
import { CONFIG } from "../js/config.js";

test("parseFormLink", () => {
  const f = parseFormLink(CONFIG.RATE_FORM);
  assert.equal(f.action, "https://docs.google.com/forms/d/e/1FAIpQLScijsTtuJGWwL3OvHnxBuPdcBRyZTUFDrCPhxtRtOllJyKrcQ/formResponse");
  assert.equal(f.entries["카카오ID"], "entry.989536997");
  assert.equal(f.entries["요청ID"], "entry.1175260167");
  assert.equal(Object.keys(f.entries).length, 17);
  assert.equal(parseFormLink("https://docs.google.com/forms/d/e/X/viewform?usp=header"), null);
  assert.equal(parseFormLink(""), null);
  assert.equal(parseFormLink("not a url"), null);
});

test("formBody 는 폼에 있는 칸만 넣는다", () => {
  const f = { action: "a", entries: { "카카오ID": "entry.1", "별점": "entry.2" } };
  const body = formBody(f, { "카카오ID": "123", "별점": 4, "모르는칸": "x" });
  assert.equal(body.toString(), "entry.1=123&entry.2=4");
});

test("reviewDue", () => {
  const now = Date.UTC(2026, 10, 21, 3);
  const place = { kakaoId: "9", name: "삼겹리에" };
  const H = 3600e3;
  assert.equal(reviewDue(now, { place, t: now - 4 * H }, new Set()), place);
  assert.equal(reviewDue(now, { place, t: now - 1 * H }, new Set()), null);
  assert.equal(reviewDue(now, { place, t: now - 4 * 24 * H }, new Set()), null);
  assert.equal(reviewDue(now, { place, t: now - 4 * H }, new Set(["9"])), null);
  assert.equal(reviewDue(now, null, new Set()), null);
});
