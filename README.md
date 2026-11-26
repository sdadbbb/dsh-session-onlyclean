# dsh-session-onlyclean

**一句话价值：给 DeepSeek Harness 补上官方没有的「永久删除会话」，按工作区浏览、确认后删除，不再只能归档。**

[中文](#中文) | [English](#english)

> 社区插件，与 DeepSeek 官方无隶属关系。删除不可恢复，请先读完[权限与风险](#权限与风险)。

## 中文

### 功能

| 入口 | 行为 |
|---|---|
| 侧栏会话行的悬停按钮（`…` 菜单右侧的垃圾桶图标） | 打开确认对话框，永久删除该会话 |
| 设置 → **会话管理** | 按工作区列出全部会话（标题、创建时间、大小、是否已打开、分叉数），逐条删除 |

删除会移除该会话在本机的全部持久化记录：

- `<DSH_HOME>/sessions/<项目目录>/<会话 id>/`（会话日志目录）
- `<DSH_HOME>/storages/session_projcache/sessions/<会话 id>.json`（投影缓存，派生数据）
- 工作区账目中的会话条目（经官方 `detachSession`），因此侧栏立即消失，重启后也不会回来

### 安装

通过 npm（推荐，可在应用内「插件中心」一键安装）：

```bash
dsh plugin --profile web add dsh-session-onlyclean
```

从 GitHub 源码安装：

```bash
dsh plugin --profile web add github:sdadbbb/dsh-session-onlyclean
```

`web` 换成你的 profile 名；Desktop 客户端也可在应用内的「插件」中安装。安装后刷新 Web UI 页面。

本地开发：

```bash
dsh plugin --profile web add /path/to/dsh-session-onlyclean
```

依赖的 Host 服务：`webServer`、`sessionPersistence`、`sessionQuery`、`workspaceRegistry`、`sessions`。

### 安全与权限

- **删除不可恢复**，没有回收站；确认框会显示目标会话的标题、创建时间、实际大小与磁盘位置。
- **只删除被证明的目录**：只有当日志路径能证明为 `<DSH_HOME>/sessions/<项目目录>/<会话 id>/` 时才动手，路径不符一律拒绝，不存在"删错目录"的路径。
- **以「日志写占用」为唯一闸门**：删除前用 `sessionPersistence.open(id, 'write')` 探一次写权限，拿得到才删；拿不到说明本轮 DSH 正持有该会话（打开着、正在生成或正在起标题），此时拒绝并说明原因，其他异常一律按占用处理（fail-closed）。
- **有分叉子会话时拒绝删除**：子会话可能依赖父会话的日志前缀，先删父会破坏子会话。
- **先删文件、后改账目**：文件删除失败不会留下"已隐藏但未删除"的半删状态。
- **只在本机操作**：插件不联网、不上传任何数据；只读写 `<DSH_HOME>` 下的会话存储与工作区账目，不修改项目目录、不删除工作区、不触碰共享附件。
- **HTTP 面是封闭的**：三个同源 `POST` 路由只接受 `content-type: application/json`，存在 `Origin` 时校验同源，其他页面无法触发删除。

### 兼容性

| DeepSeek Harness | 环境 | 状态 |
|---|---|---|
| 0.2.2-rc.1 | Desktop / Web UI | 实测可用 |
| 0.2.x 其他版本 | Desktop / Web UI | 未逐一验证；插件只依赖 `webServer` / `sessionPersistence` / `sessionQuery` / `workspaceRegistry` / `sessions` 与三个客户端 Slot，版本变动可能影响 |

### 工作原理

- **Host 半**（`index.js`）注册三个同源 `POST` 路由：
  - `/dsh-session-onlyclean/list`：工作区 + 会话聚合（标题来自 `sessionQuery.readTitleSnapshots`）
  - `/dsh-session-onlyclean/preview`：删除前确认信息（路径校验、目录大小、分叉检查、写占用探测）
  - `/dsh-session-onlyclean/delete`：校验 → 删除目录 → 清缓存 → `unarchiveSession` + `detachSession` → 广播 `api-session/removed`
- **Client 半**（`client.js`）注册 `sidebar.workspaces.session.row.action`（悬停按钮）、`settings.section`（会话管理页）、`shell.overlay`（确认对话框 + 轻提示）。删除成功后调用 `ctx.sessions.refresh()` 重拉会话列表。文案走 `ctx.locale`（中/英），样式只使用 `--dsw-alias-*` 主题 token。
- **为什么删除后还要刷新列表**：侧栏的「未分组」是客户端派生的——会话列表里不属于任何 `workspace.sessionIds` 的会话。只摘掉工作区记账而不刷新客户端列表，行就会从工作区分组掉进「未分组」。所以删除时 Host 广播 `api-session/removed`（Session Controller 自带的删除通道），客户端再主动刷新兜底。

### 已知边界

- **官方 UI 没有"关闭会话"入口**。一次 DSH 运行中打开过的会话会保留一个 live Agent，并持续持有日志写句柄（实测空闲 20 小时以上仍持有），所以这些会话在本次运行里删不掉，只能重启 DSH 后（在重新打开它们之前）删除。设置页的「已打开」徽标标出的就是这批会话。
- 只处理**已登记工作区**的会话；不属于任何工作区的历史会话（例如手工指定过其他 cwd 的会话）不会出现在列表里。
- 附件（图片/文件）按内容寻址、可能被多个会话共享，因此不随会话删除。
- 会话一旦删除不可恢复，也没有回收站。

### 开发

无构建步骤：`index.js` 是 Host 端 ESM 插件，`client.js` 是浏览器端 bundle。提交前至少做语法检查：

```bash
node --check index.js
node --check client.js
```

### 许可证

[MIT](LICENSE)

## English

A community plugin for DeepSeek Harness that adds the missing **permanent session deletion**, grouped by workspace.

- Sidebar session row → trash button → confirm → the session's local records are removed for good.
- Settings → **Session manager** → browse every workspace's sessions (title, date, size, open state, fork count) and delete them one by one.

What gets removed: `<DSH_HOME>/sessions/<cwd>/<sessionId>/`, the derived projection-cache file, and the workspace accounting entry (via the official `detachSession`), so the row disappears immediately and does not come back after a restart.

Install:

```bash
dsh plugin --profile web add dsh-session-onlyclean
# or from source
dsh plugin --profile web add github:sdadbbb/dsh-session-onlyclean
```

Safety: deletion is irreversible; only a path proven to be `<DSH_HOME>/sessions/<cwd>/<sessionId>/` is touched; a session whose log is write-owned (open or running in this DSH run) is refused; sessions with fork descendants are refused; files are removed before any bookkeeping. The plugin never talks to the network and only touches the session store under `<DSH_HOME>`.

Known limits: a session opened during the current DSH run keeps a live Agent holding its write handle, so it can only be deleted after a DSH restart; sessions outside registered workspaces are not listed; attachments are shared and left alone.

License: MIT.
