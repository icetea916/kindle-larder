import { createLarder } from "./larder.js";
import { renderPage } from "./page.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const larder = createLarder({
      db: env.DB,
      password: env.LARDER_PASSWORD,
      now: () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })),
    });
    const token = readCookie(request, "larder_token");

    if (url.pathname.startsWith("/api/")) return api(request, url, larder, token);
    return web(request, url, larder, token);
  },
};

async function api(request, url, larder, cookieToken) {
  const token = bearerToken(request) || cookieToken;
  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await readBody(request);
    const result = await larder.login(body.password);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ token: result.token });
  }

  if (!(await larder.authenticate(token))) return json({ error: "未登录" }, 401);

  if (url.pathname === "/api/logout" && request.method === "POST") {
    await larder.logout(token);
    return json({ ok: true });
  }
  if (url.pathname === "/api/items" && request.method === "GET") {
    return json(await larder.list());
  }
  if (url.pathname === "/api/items" && request.method === "POST") {
    const result = await larder.create(await readBody(request));
    return json(result.ok ? { item: result.item } : { error: result.error }, result.status || 200);
  }

  const match = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (!match) return json({ error: "不存在" }, 404);
  const id = decodeURIComponent(match[1]);
  if (request.method === "PATCH") {
    const result = await larder.update(id, await readBody(request));
    return json(result.ok ? { item: result.item } : { error: result.error }, result.status || 200);
  }
  if (request.method === "DELETE") {
    const result = await larder.remove(id);
    return json(result.ok ? { ok: true } : { error: result.error }, result.status || 200);
  }
  return json({ error: "不支持的请求" }, 405);
}

async function web(request, url, larder, token) {
  const authenticated = await larder.authenticate(token);
  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    const result = await larder.login(form.get("password"));
    if (!result.ok) return htmlResponse(renderPage({ authenticated: false, error: result.error }), 401);
    return redirect("/", cookie(result.token));
  }

  if (!authenticated) {
    if (url.pathname !== "/") return redirect("/login");
    return htmlResponse(renderPage({ authenticated: false }));
  }

  if (url.pathname === "/logout" && request.method === "POST") {
    await larder.logout(token);
    return redirect("/login", "larder_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  }

  if (url.pathname === "/items" && request.method === "POST") {
    const result = await larder.create(await formItem(request));
    if (!result.ok) return page(larder, token, { error: result.error }, 400);
    return redirect("/");
  }

  const edit = url.pathname.match(/^\/items\/([^/]+)$/);
  if (edit && request.method === "POST") {
    const result = await larder.update(decodeURIComponent(edit[1]), await formItem(request));
    if (!result.ok) return page(larder, token, { error: result.error, editId: decodeURIComponent(edit[1]) }, result.status);
    return redirect("/");
  }

  const remove = url.pathname.match(/^\/items\/([^/]+)\/delete$/);
  if (remove && request.method === "POST") {
    const result = await larder.remove(decodeURIComponent(remove[1]));
    if (!result.ok) return page(larder, token, { error: result.error }, result.status);
    return redirect("/");
  }

  if (url.pathname !== "/") return htmlResponse("不存在", 404);
  return page(larder, token, {
    editId: url.searchParams.get("edit"),
    due: url.searchParams.get("due") === "7",
  });
}

async function page(larder, token, extra, status = 200) {
  const list = await larder.list();
  const editing = extra.editId && list.items.find((item) => item.id === extra.editId);
  return htmlResponse(renderPage({
    authenticated: true,
    items: list.items,
    editing,
    due: extra.due,
    error: extra.error,
    today: shanghaiDate(),
  }), status);
}

async function formItem(request) {
  const form = await request.formData();
  return {
    name: form.get("name"),
    quantity: Number(form.get("quantity")),
    expires_on: form.get("expires_on"),
  };
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function readCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function cookie(token) {
  return `larder_token=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`;
}

function redirect(location, setCookie) {
  const headers = { location };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(null, { status: 303, headers });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
