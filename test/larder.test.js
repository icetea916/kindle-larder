import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createLarder, dueWithin, parseItem } from "../src/larder.js";

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      expires_on TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        async all() {
          return { results: statement.all() };
        },
        bind(...values) {
          return {
            async run() {
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
            async first() {
              return statement.get(...values) || null;
            },
            async all() {
              return { results: statement.all(...values) };
            },
          };
        },
      };
    },
  };
}

function app() {
  let ticks = 0;
  return createLarder({
    db: createDb(),
    password: "secret",
    now: () => new Date(Date.UTC(2026, 10, 10, ticks++)),
    tokenBytes: () => Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + ticks)),
  });
}

test("wrong password cannot read or change the list", async () => {
  const larder = app();
  const denied = await larder.login("nope");
  assert.equal(denied.ok, false);
  assert.equal(await larder.authenticate("missing"), false);
});

test("password allows create, update, and delete", async () => {
  const larder = app();
  const login = await larder.login("secret");
  assert.equal(await larder.authenticate(login.token), true);

  const created = await larder.create({ name: "牛奶", quantity: 2, expires_on: "2026-11-12" });
  assert.equal(created.ok, true);
  const updated = await larder.update(created.item.id, { name: "酸奶", quantity: 1, expires_on: "" });
  assert.equal(updated.item.name, "酸奶");
  assert.equal(updated.item.expires_on, null);

  assert.equal((await larder.list()).items.length, 1);
  assert.equal((await larder.remove(created.item.id)).ok, true);
  assert.equal((await larder.list()).items.length, 0);
});

test("logout revokes the token", async () => {
  const larder = app();
  const login = await larder.login("secret");
  await larder.logout(login.token);
  assert.equal(await larder.authenticate(login.token), false);
});

test("item fields reject blank names and bad dates", () => {
  assert.equal(parseItem({ name: "  ", quantity: 1 }).ok, false);
  assert.equal(parseItem({ name: "鸡蛋", quantity: 0 }).ok, false);
  assert.equal(parseItem({ name: "鸡蛋", quantity: 1, expires_on: "2026-02-31" }).ok, false);
});

test("seven day filter includes today through the seventh day only", () => {
  const due = dueWithin([
    { name: "过期酸奶", expires_on: "2026-11-09" },
    { name: "今天的菜", expires_on: "2026-11-10" },
    { name: "七天后", expires_on: "2026-11-17" },
    { name: "更晚", expires_on: "2026-11-18" },
    { name: "没写日期", expires_on: null },
  ], "2026-11-10");
  assert.deepEqual(due.map((item) => item.name), ["今天的菜", "七天后"]);
});
