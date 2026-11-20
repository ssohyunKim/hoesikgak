/* 낮(5:00~16:59)은 day, 밤은 night. 손으로 바꾸면 그날 하루만 기억한다.
   색은 css/theme.css 에만 있다 */
import * as store from "./store.js";

const KEY = "hoesik.theme";
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isDay = d => d.getHours() >= 5 && d.getHours() < 17;

export function themeFor(date, saved) {
  if (saved && saved.day === ymd(date) && (saved.theme === "day" || saved.theme === "night")) return saved.theme;
  return isDay(date) ? "day" : "night";
}
export const mealFor = date => isDay(date) ? "lunch" : "dinner";

export function applyTheme(now = new Date()) {
  const t = themeFor(now, store.get(KEY, null));
  document.documentElement.dataset.theme = t;
  return t;
}
export function toggleTheme(now = new Date()) {
  const next = document.documentElement.dataset.theme === "night" ? "day" : "night";
  store.set(KEY, { theme: next, day: ymd(now) });
  document.documentElement.dataset.theme = next;
  return next;
}
