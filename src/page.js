import { dueWithin } from "./larder.js";

export function renderPage(state) {
  const today = state.today;
  if (!state.authenticated) return layout("登录", loginView(state), false);
  return layout("Larder", listView(state, today), true);
}

function loginView(state) {
  return `
    <main class="login">
      <p class="eyebrow">厨房存货</p>
      <h1>看看还剩什么。</h1>
      ${notice(state)}
      <form method="post" action="/login">
        <label>密码<input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit">进入清单</button>
      </form>
    </main>`;
}

function listView(state, today) {
  const editing = state.editing;
  const items = state.due ? dueWithin(state.items, today, 7) : state.items;
  const query = state.due ? "due=7" : "";
  return `
    <header class="top">
      <div>
        <p class="eyebrow">${escapeHtml(today)} · 上海</p>
        <h1>${state.due ? `七天内到期 ${items.length} 样。` : `还剩 ${items.length} 样。`}</h1>
      </div>
      <form method="post" action="/logout"><button class="quiet" type="submit">退出</button></form>
    </header>
    ${notice(state)}
    <nav class="filters">
      <a class="${state.due ? "" : "current"}" href="/">全部</a>
      <a class="${state.due ? "current" : ""}" href="/?due=7">7 天内到期</a>
    </nav>
    <section class="composer">
      <h2>${editing ? "修改" : "放进去"}</h2>
      ${itemForm(editing, query)}
    </section>
    <section class="list">
      ${items.length ? items.map((item) => card(item, editing, query)).join("") : `<p class="empty">${state.due ? "这七天没有要到期的" : "还是空的"}</p>`}
    </section>
  `;
}
function card(item, editing, query) {
  const expiry = item.expires_on ? `到期 ${item.expires_on}` : "没有填到期日";
  const editQuery = [query, `edit=${encodeURIComponent(item.id)}`].filter(Boolean).join("&");
  return `
    <article class="item">
      <div>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(expiry)} · ${item.quantity} 个</p>
      </div>
      <div class="actions">
        <a class="${editing && editing.id === item.id ? "current" : ""}" href="/?${editQuery}">修改</a>
        <form method="post" action="/items/${encodeURIComponent(item.id)}/delete">
          <button type="submit">用完了</button>
        </form>
      </div>
    </article>`;
}

function itemForm(item, query) {
  const action = item ? `/items/${encodeURIComponent(item.id)}` : "/items";
  const cancel = query ? `/?${query}` : "/";
  return `
    <form method="post" action="${action}">
      <label>名称<input name="name" maxlength="80" required value="${escapeHtml(item ? item.name : "")}"></label>
      <label>数量<input name="quantity" type="number" min="1" max="999" required value="${item ? item.quantity : 1}"></label>
      <label>到期日<input name="expires_on" type="date" value="${escapeHtml(item && item.expires_on ? item.expires_on : "")}"></label>
      <div class="actions">
        <button type="submit">${item ? "保存" : "添加"}</button>
        ${item ? `<a href="${cancel}">取消</a>` : ""}
      </div>
    </form>`;
}

function notice(state) {
  if (!state.error) return "";
  return `<p class="error" role="alert">${escapeHtml(state.error)}</p>`;
}

function layout(title, body, app) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${css(app)}</style>
</head>
<body>${body}</body>
</html>`;
}

function css(app) {
  return `
    :root {
      color-scheme: light;
      --ink: #1d2420;
      --paper: #f3efe4;
      --panel: #fffaf1;
      --line: #d9d0bf;
      --green: #315c45;
      --red: #8d3d32;
      --amber: #8a5a12;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 85% -10%, #e7f0df 0 18%, transparent 19%),
        linear-gradient(180deg, #f7f4ec 0%, var(--paper) 100%);
      color: var(--ink);
      font: 17px/1.45 "Iowan Old Style", "Palatino Linotype", Palatino, "Songti SC", serif;
    }
    body, input, button, a { font-family: inherit; }
    .login, .top, .filters, .composer, .list { width: min(920px, calc(100% - 32px)); margin-inline: auto; }
    .login { min-height: 100vh; display: grid; align-content: center; }
    .top { display: flex; justify-content: space-between; align-items: end; padding-top: 36px; gap: 20px; }
    h1 { margin: 0; font-size: clamp(42px, 7vw, 78px); line-height: .95; font-weight: 650; letter-spacing: -.045em; }
    h2 { margin: 0 0 14px; font-size: 22px; }
    h3 { margin: 0; font-size: 24px; }
    p { margin: 0; }
    .eyebrow { margin-bottom: 8px; color: var(--green); letter-spacing: .12em; text-transform: uppercase; font-size: 13px; }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 5px; color: #5e675f; font-size: 14px; }
    input {
      width: 100%; border: 0; border-bottom: 1.5px solid var(--line); background: transparent;
      color: var(--ink); font-size: 20px; padding: 8px 0;
    }
    button, .actions a {
      border: 0; border-radius: 999px; background: var(--green); color: white;
      padding: 11px 18px; text-decoration: none; font-size: 16px; cursor: pointer;
    }
    .quiet, .actions a { background: transparent; color: var(--green); border: 1px solid var(--line); }
    .composer, .item {
      background: var(--panel); border: 1px solid var(--line); border-radius: 24px;
      padding: 20px; box-shadow: 0 12px 30px #1d242008;
    }
    .filters { display: flex; gap: 8px; margin-top: 28px; }
    .filters a { background: transparent; color: var(--green); border: 1px solid var(--line); }
    .filters a.current { background: var(--green); color: white; }
    .composer { margin: 18px auto; }
    .composer form, .item { grid-template-columns: 1.5fr .5fr .8fr auto; align-items: end; }
    .composer form { display: grid; }
    .item { display: grid; grid-template-columns: 1fr auto; gap: 16px; margin-bottom: 10px; }
    .item p { color: #667064; margin-top: 4px; }
    .list { margin-bottom: 36px; }
    .actions { display: flex; gap: 8px; align-items: center; }
    .actions form { display: block; }
    .current { background: #e8f0e4; }
    .error { width: min(920px, calc(100% - 32px)); margin: 18px auto; color: var(--red); }
    .empty { color: #817864; }
    @media (max-width: 720px) {
      h1 { font-size: 48px; }
      .top, .item, .composer form { display: grid; grid-template-columns: 1fr; }
      .actions { justify-content: space-between; }
    }
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
