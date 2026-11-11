# Larder

厨房存货清单。冷藏、冷冻和其他厨房物品放在同一份清单里。手机或电脑用网页新增和修改，Kindle 只负责查看，并可以把已经用完的东西划掉。

每条记录有名称、数量和到期日。到期日可以不填，数量是 1 到 999 的整数。清单默认按到期日排成一个列表，不再分组。页面和 Kindle 都可以切到「7 天内到期」，只显示从今天到第 7 天到期的物品，不包括已经过期和没有填到期日的。

网页和 Kindle 共用一个密码。密码只放在本地 `.dev.vars` 或 Cloudflare Secret 里，不进仓库。登录后发一个可撤销的令牌；退出登录会使这个令牌失效。删除是直接删除，不保留已用完的历史。

## 目录

```text
src/index.js                  网页和 API 入口
src/larder.js                 登录、清单和字段校验
src/page.js                   网页页面
koreader/larder.koplugin/     KOReader 插件
migrations/0001_init.sql      D1 表结构
test/                         登录、增删改和 7 天筛选测试
wrangler.toml                 Worker 和 D1 配置
```

## 本地运行

需要 Node.js 20 或更新。在 `larder` 目录里：

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

把 `.dev.vars` 里的 `LARDER_PASSWORD` 改成自己的密码。`wrangler dev` 会给出本地地址，浏览器打开后用这个密码登录。

测试：

```sh
npm test
```

## 部署

使用自己的 Cloudflare 账号。Workers 和 D1 都走免费额度，先用 Workers 的默认域名。

1. 创建名为 `larder` 的 D1 数据库。
2. 把返回的数据库 id 填进 `wrangler.toml` 的 `database_id`。现在那串全零是占位，不能直接部署。
3. 设置密码并发布：

```sh
npx wrangler secret put LARDER_PASSWORD
npm run db:migrate:remote
npm run deploy
```

部署完成后，终端输出的 `workers.dev` 地址就是网页和 Kindle 要填的服务器地址。

## 网页

登录后可以添加、修改和删除。添加时填名称和数量，到期日可选。点「用完了」会直接删掉这一条。

API 也使用同一个密码。除登录外，请求头带 `Authorization: Bearer <token>`。

- `POST /api/login`，请求体 `{ "password": "..." }`，返回 `{ "token": "..." }`。
- `POST /api/logout`，撤销当前令牌。
- `GET /api/items`，返回全部物品。
- `POST /api/items`，请求体 `{ "name", "quantity", "expires_on" }`。`expires_on` 用 `YYYY-MM-DD`，也可以传空字符串。
- `PATCH /api/items/:id`，字段和新增相同。
- `DELETE /api/items/:id`。

密码错误或没有令牌时返回 401，不能查看或修改清单。

## Kindle

插件按 KOReader v2026.07.1 编写。把 `koreader/larder.koplugin` 整个目录拷到 Kindle 的 `koreader/plugins/`。完全退出 KOReader，再从书库点「KOReader Stop Framework」进入。只回到主页不算重启，插件不会加载。

进入后：

1. 打开「Larder 设置」，填写部署后的服务器地址和密码。两项都保存在这台 Kindle 上。
2. 打开「Larder」查看清单。
3. 点一项并确认，就把它从清单里删除。

Kindle 上不能新增或修改。没有 Wi-Fi 或请求失败时，仍然显示上次成功拿到的清单，标题会写明这是离线缓存和缓存时间。缓存和登录令牌都在 Kindle 本机，不会写回这个仓库。

## 本地调试

模拟器只用于看界面和请求，不能代替 Kindle 上的墨水屏和内存检查。本地服务要先在 `larder` 目录跑起来：

```sh
npm run dev
```

然后在 `../koreader-emulator` 目录启动模拟器。插件代码用软链接连过去，改完代码后完全退出模拟器再启动：

```sh
export KO_HOME="$PWD/larder-emu-home"
mkdir -p "$KO_HOME/plugins/larder.koplugin"
ln -sfn "$PWD/../larder/koreader/larder.koplugin/main.lua" "$KO_HOME/plugins/larder.koplugin/main.lua"
ln -sfn "$PWD/../larder/koreader/larder.koplugin/_meta.lua" "$KO_HOME/plugins/larder.koplugin/_meta.lua"

cd koreader-emulator-arm64-apple-darwin24.6.0-debug/koreader
KO_HOME="$KO_HOME" EMULATE_READER_W=600 EMULATE_READER_H=800 EMULATE_READER_DPI=167 ./luajit reader.lua -d
```

点屏幕顶部打开菜单，选择 Larder。服务器地址填 `http://127.0.0.1:8787`，密码用 `.dev.vars` 里的 `LARDER_PASSWORD`。这个地址只能给本机模拟器用，Kindle 要填电脑的局域网地址。
