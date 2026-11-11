const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createLarder(options) {
  const db = options.db;
  const password = options.password;
  const now = options.now || (() => new Date());
  const tokenBytes = options.tokenBytes || randomToken;

  return {
    login,
    logout,
    list,
    create,
    update,
    remove,
    authenticate,
  };

  async function login(submittedPassword) {
    if (!password || submittedPassword !== password) {
      return { ok: false, status: 401, error: "密码不正确" };
    }
    const token = bytesToHex(tokenBytes(32));
    const createdAt = now().toISOString();
    await db
      .prepare("INSERT INTO sessions (token_hash, created_at) VALUES (?, ?)")
      .bind(await sha256(token), createdAt)
      .run();
    return { ok: true, token };
  }

  async function logout(token) {
    if (token) {
      await db
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await sha256(token))
        .run();
    }
    return { ok: true };
  }

  async function authenticate(token) {
    if (!token) return false;
    const row = await db
      .prepare("SELECT token_hash FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .first();
    return Boolean(row);
  }

  async function list() {
    const result = await db
      .prepare(
        "SELECT id, name, quantity, expires_on, updated_at FROM items ORDER BY CASE WHEN expires_on IS NULL THEN 1 ELSE 0 END, expires_on, name"
      )
      .all();
    return { ok: true, items: result.results || [] };
  }

  async function create(input) {
    const parsed = parseItem(input);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    const item = {
      id: crypto.randomUUID(),
      ...parsed.value,
      updated_at: now().toISOString(),
    };
    await db
      .prepare("INSERT INTO items (id, name, quantity, expires_on, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(item.id, item.name, item.quantity, item.expires_on, item.updated_at)
      .run();
    return { ok: true, status: 201, item };
  }

  async function update(id, input) {
    const existing = await findItem(id);
    if (!existing) return { ok: false, status: 404, error: "物品不存在" };
    const parsed = parseItem(input);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    const item = {
      id,
      ...parsed.value,
      updated_at: now().toISOString(),
    };
    await db
      .prepare("UPDATE items SET name = ?, quantity = ?, expires_on = ?, updated_at = ? WHERE id = ?")
      .bind(item.name, item.quantity, item.expires_on, item.updated_at, id)
      .run();
    return { ok: true, item };
  }

  async function remove(id) {
    const result = await db.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
    if (!result.meta || result.meta.changes === 0) {
      return { ok: false, status: 404, error: "物品不存在" };
    }
    return { ok: true };
  }

  async function findItem(id) {
    return db.prepare("SELECT id FROM items WHERE id = ?").bind(id).first();
  }
}

export function parseItem(input) {
  const source = input || {};
  const name = String(source.name || "").trim();
  if (!name || name.length > 80) return { ok: false, error: "名称需要 1 到 80 个字符" };

  const quantity = Number(source.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { ok: false, error: "数量必须是 1 到 999 的整数" };
  }

  const rawDate = String(source.expires_on || "").trim();
  if (rawDate && (!DATE_PATTERN.test(rawDate) || !isRealDate(rawDate))) {
    return { ok: false, error: "到期日格式不正确" };
  }

  return {
    ok: true,
    value: { name, quantity, expires_on: rawDate || null },
  };
}

export function dueWithin(items, today, days = 7) {
  const current = today || isoDate(new Date());
  const limit = addDays(current, days);
  return (items || []).filter((item) => item.expires_on && item.expires_on >= current && item.expires_on <= limit);
}

function isRealDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function randomToken(size) {
  return crypto.getRandomValues(new Uint8Array(size));
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
