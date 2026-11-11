import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../koreader/larder.koplugin/main.lua", import.meta.url), "utf8");

function dueWithin(items, today) {
  const limit = shiftDate(today, 7);
  return items.filter((item) => item.expires_on && item.expires_on >= today && item.expires_on <= limit);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("plugin source lists items and offers a seven day filter", () => {
  assert.match(source, /KeyValuePage/);
  assert.match(source, /due_only/);
  assert.match(source, /7 \* 86400/);
  assert.match(source, /cached = true/);
  assert.equal(dueWithin([
    { expires_on: "2026-11-09" },
    { expires_on: "2026-11-10" },
    { expires_on: "2026-11-17" },
    { expires_on: "" },
  ], "2026-11-10").length, 2);
});
