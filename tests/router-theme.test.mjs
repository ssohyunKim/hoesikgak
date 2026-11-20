import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, buildHash } from "../js/router.js";
import { themeFor, mealFor } from "../js/theme.js";

const C = { s: "team", n: 8, b: "3050", at: "보라매", w: ["room"], x: ["1", "2"] };

test("buildHash / parseHash 왕복", () => {
  const h = buildHash("picks", C);
  assert.equal(h, "#/picks?s=team&n=8&b=3050&at=%EB%B3%B4%EB%9D%BC%EB%A7%A4&w=room&x=1,2");
  assert.deepEqual(parseHash(h), { view: "picks", cond: C });
});

test("빈 해시와 잘못된 값", () => {
  assert.deepEqual(parseHash(""), { view: "home", cond: {} });
  assert.deepEqual(parseHash("#/"), { view: "home", cond: {} });
  assert.deepEqual(parseHash("#/setup?n=abc&s=vip"), { view: "setup", cond: { s: "vip" } });
  assert.equal(parseHash("#/nope").view, "home");
  assert.equal(buildHash("home", {}), "#/");
  assert.equal(buildHash("setup", { s: "any", n: null, b: "any", w: [], x: [] }), "#/setup?s=any&b=any");
});

const at = (h, m = 0) => new Date(2026, 10, 20, h, m);
test("themeFor", () => {
  assert.equal(themeFor(at(12)), "day");
  assert.equal(themeFor(at(17)), "night");
  assert.equal(themeFor(at(4, 59)), "night");
  assert.equal(themeFor(at(5)), "day");
  assert.equal(themeFor(at(12), { theme: "night", day: "2026-11-20" }), "night");
  assert.equal(themeFor(at(12), { theme: "night", day: "2026-11-19" }), "day");
});

test("mealFor", () => {
  assert.equal(mealFor(at(11)), "lunch");
  assert.equal(mealFor(at(18)), "dinner");
  assert.equal(mealFor(at(2)), "dinner");
});
