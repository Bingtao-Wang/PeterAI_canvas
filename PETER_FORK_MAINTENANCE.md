# PeterAI Canvas Fork 维护手册

## 当前基线

| 项目 | 值 |
| --- | --- |
| 上游 | `basketikun/infinite-canvas@ebd8ae2`（根版本 `v0.6.0` 后的 main） |
| 生产分支 | `custom/peterai` |
| 上游镜像分支 | `main`，只跟踪 `upstream/main` |
| 公共源码 | `https://github.com/Bingtao-Wang/PeterAI_canvas` |
| GHCR 镜像包 | `ghcr.io/bingtao-wang/peterai-canvas`（稳定逻辑名称，有意与仓库下划线命名不同） |
| 生产域名 | `https://canvas.peterai.cc.cd` |
| 本机入口 | `http://127.0.0.1:13000` |
| Sub2API | `http://127.0.0.1:18080`，只经 `/peter-api` 白名单代理 |
| Sub2API 菜单 ID | `51be877493a8929d` |

生产源码 commit 由发布脚本读取 `git rev-parse HEAD`，写入镜像内源码链接；每次发布记录实际镜像 tag、Git tag 和 commit，三者必须一致，不能用工作区构建替代正式发布。

当前生产构建为源码 `8df0d1dfe3ce`、镜像 `peterai-canvas:20260712-upstream-ebd8ae2-8df0d1df`。`custom/peterai` 已推送到公共仓库，精确 commit URL 已验证可公开访问；本机与公网健康、安全头、查询字符串脱敏、代理白名单、源码链接、DNS/Tunnel、正式菜单、iframe URL 和 CSP 均已验收。手工填写 PeterAI API 域名会使用同源 `/peter-api`，嵌入页不再默认打开可选本地 Agent。`available_channels_enabled` 当前仍关闭：图片模型可从生图选项安全导入，非图片托管模型要等真实账号、显式能力和价格验收后再开放。

## 定制不变量

- 应用必须先通过 `/api/v1/auth/me` 验证用户，再加载 Zustand 和 IndexedDB。
- `src_host` 只能是已配置的 PeterAI origin；JWT 进入地址后立即移除，只允许暂存在 `sessionStorage`。
- PeterAI API Key 只驻留内存，不能进入 localStorage、IndexedDB、导出 ZIP 或 WebDAV。
- 所有业务存储使用后端用户 ID 命名空间 `peterai-canvas:<user-id>`。
- PeterAI 渠道只调用当前域名的 `/peter-api`，不能绕过 Sub2API 直连真实上游。
- Canvas 不提供独立注册或登录；所有业务用户必须先通过 PeterAI JWT 验证。用户主动配置的自有 URL/API Key 渠道继续保留，并明确标记为非 PeterAI 托管；第三方域名保持浏览器直连，手工填写 PeterAI 官方站点域名时必须归一化到同源 `/peter-api`，避免绕过站内计费或触发 CORS。
- 图片模型和价格来自 `/user/image-generation/options`；价格缺失时显示“以实际扣费为准”。
- 非图片模型必须同时出现在 Key 的 `/v1/models` 和 `/channels/available` 分组元数据中；无法可靠分类的模型不进入默认列表。
- 生图每个请求固定 `n=1`，浏览器队列最多 4 并发；失败结果不允许发布 Gallery。
- `/peter-api` 必须是路由和方法白名单，禁止退化为任意 Sub2API 反向代理。
- iframe 只允许 PeterAI 主站作为 `frame-ancestors`，不得设置 `SAMEORIGIN`。
- 保留原 Infinite Canvas 作者、AGPL-3.0 标识和上游链接；生产页面必须链接到本 fork 对应源码。

## 上游同步

生产分支只合并正式 tag，不自动合并上游 main：

```bash
git fetch upstream --prune --tags
git checkout custom/peterai
git status --short --branch
git branch custom/peterai-backup-YYYYMMDD-before-vX.Y.Z
git merge --no-edit vX.Y.Z
```

冲突处理以上游新结构为基础，Peter 逻辑尽量保留在 `web/src/peter/`。大型画布页只保留并发队列、Gallery 接线和源码入口等最小改动。生产分支不 rebase。

同步后必须执行：

```bash
npm -C web install --legacy-peer-deps
npm -C web run test:run
npm -C web run typecheck -- --pretty false
npm -C web run build
npm -C canvas-agent run build
docker build -t peterai-canvas:verify .
```

## 发布

镜像使用不可变版本：

```text
peterai-canvas:YYYYMMDD-upstream-vX.Y.Z-<custom-sha>
```

禁止生产使用 `latest`。发布流程：

```bash
cp deploy/.env.example deploy/.env   # 首次部署
deploy/publish.sh
```

首次发布只做本机验收；公网和菜单就绪后再逐层验收：

```bash
deploy/verify-production.sh
VERIFY_PUBLIC=1 deploy/verify-production.sh
VERIFY_PUBLIC=1 VERIFY_MENU=1 deploy/verify-production.sh
```

Sub2API 管理设置中的 `available_channels_enabled` 必须开启，否则 `/channels/available` 按设计返回空数组，Canvas 只会安全导入 `image-generation/options` 能确认的图片模型，不会猜测文本或视频能力。

### 当前 Sub2API 能力边界

Sub2API 真实路由支持 Models、Responses、Images、Grok 视频，以及 PeterAI 托管媒体端点：

```text
POST /v1/audio/speech
POST /v1/contents/generations/tasks
GET  /v1/contents/generations/tasks/:task_id
```

Audio/Seedance 账号必须是 OpenAI APIKey 类型，并由管理员显式勾选 `audio_speech` 或 `seedance` 能力；没有显式能力时调度器必须拒绝。Audio 必须有独立 `per_request` 默认价格；Seedance 必须有按分辨率的渠道按次价或分组视频每秒价，自动时长只能使用按次价，避免按猜测秒数扣费。缺账号能力或价格时接口返回明确错误，不允许误选普通 Codex 账号、按零价放行或使用图片默认价格。Seedance 创建成功后绑定 task 与账号，轮询沿用相同账号。

Canvas Nginx 将公开的 `POST /peter-api/v1/videos` 精确改写到 Grok 创建路由；Peter managed adapter 必须发送 Sub2API/xAI JSON 字段 `model`、`prompt`、`duration`、`resolution` 和可选单张 `image.image_url`，并兼容创建响应的 `request_id` 与轮询响应的 `video.url`。视频 `/content` 仍未实现，PeterAI 适配器只接受状态响应中的可下载 URL。用户手工第三方 URL/API Key 渠道保持上游原直连行为；手工填写 `api.peterai.cc.cd` 或 `api.peteraix.com` 时作为站内特例使用 `/peter-api`。

先发布并验证 Canvas，再通过 Sub2API 管理设置添加或恢复菜单。Cloudflare Tunnel 路由为：

```text
canvas.peterai.cc.cd -> http://localhost:13000
```

Git tag 使用 `peter-vX.Y.Z-upstream-<upstream-version>`，公开源码 commit 必须和生产镜像一致。推送 `peter-v*` tag 后，release workflow 必须先通过 Web 单测、typecheck、build、关键 E2E 和 Canvas Agent build，随后才推送多架构 GHCR 镜像并创建 GitHub Release；失败时不得手工补发未经同等验证的镜像。

## 验证与回滚

```bash
deploy/verify-production.sh
docker ps --filter name=peterai-canvas
docker logs --since=30m peterai-canvas
```

回滚只需把 `deploy/.env` 的 `PETERAI_CANVAS_IMAGE` 改为上一已验证镜像并重建 Canvas 容器。故障时可先在 Sub2API 的 `custom_menu_items` 中隐藏 ID `51be877493a8929d`，不要删除原 PeterAI 画图菜单，也不要更换 Canvas 域名；浏览器画布数据依赖固定 origin。
