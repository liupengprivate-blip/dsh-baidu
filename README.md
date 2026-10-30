# dsh-baidu · 搜索引擎模拟器

[DeepSeek Harness](https://github.com/cordiverse/dsh) 的一个最小示例插件：在 Web 界面左侧栏加一个入口，
点开是一个**模拟的搜索引擎页面**；输入关键词后调用 **DSH 本地搜索接口**（`ctx.web.search`，
与智能体的 `web_search` 工具同一个能力），列出**前 10 条**真实搜索结果。

> 这是一个 demo 级插件，刻意保持很小：没有分页、没有历史记录、没有设置项，代码可以直接当
> 写 DSH 侧栏面板插件的模板读。

仓库：<https://github.com/liupengprivate-blip/dsh-baidu>

## 功能

- **左侧栏入口**：图标是放大镜，名称「搜索引擎模拟器」，点击切到主列页面。
- **模拟搜索界面**：品牌行 + 单输入框 + 搜索按钮，回车或点击均可提交。
- **真实结果**：请求 DSH 的 web 搜索服务，取回前 10 条，展示标题、域名路径、摘要；标题在新标签页打开。
- **三种状态**：搜索中、无结果、失败（含「本机没配搜索服务」这类可读原因）。
- **跟随主题**：所有颜色取自 DSH 主题变量，深浅色自动适配，不依赖任何外部资源。

## 安装

插件声明了 `dsh.bundle`，安装后自动挂进 profile，不需要手改配置。

```sh
# 从本地目录试用 / 开发
dsh plugin --profile web add link:/absolute/path/to/dsh-baidu

# 从 GitHub 源码
dsh plugin --profile web add github:liupengprivate-blip/dsh-baidu

# 从 npm（暂未发布到 npm，见「上架插件市场」）
dsh plugin --profile web add dsh-baidu
```

`web` 换成你自己的 profile 名（桌面版默认是 `desktop`）。装好后如果侧栏还没有入口，刷新一次页面。

也可以在 **设置 → 插件 → 添加** 里选择本地目录安装。

## 使用

1. 左侧栏点放大镜入口。
2. 输入关键词，回车或点「搜索」。
3. 看前 10 条结果；点标题跳原网页。

前提：这台机器上 DSH 的 web 搜索可用（`设置 → 模型/网络搜索` 里配好搜索服务）。
没配好时页面会明确提示「本机没有可用的搜索服务」，而不是白屏。

## 工作原理

```
┌───────────────────────────┐        GET /dsh-baidu/search?q=…
│ 浏览器：client.js          │ ─────────────────────────────────┐
│  - sidebar.panellist 入口  │                                  │
│  - main 面板（搜索页）      │ ◀────── JSON 结果（≤10 条）──────┐│
└───────────────────────────┘                                  ││
┌───────────────────────────┐                                  ││
│ Host：index.js             │ ── ctx.web.search({…}) ──▶ 搜索服务 ││
│  - 注册一条同源只读路由      │ ◀──── sources[] ──────────         ││
└───────────────────────────┘                                  ││
```

- `index.js`（Host 半）：注册一条 `kind: 'exact'` 的只读路由，把查询转给 `ctx.web.search`，
  结果规范化为 `{ url, title, snippet, publishedAt }` 并截到 10 条。带同站校验，
  跨站请求会被拒绝。
- `client.js`（浏览器半）：用 `window.__ModuleLoader__.load` 注册两个槽位——
  `sidebar.panellist`（入口，`id` 为 `dsh-baidu`）与 `main`（页面，`key` 同为 `dsh-baidu`）。
  壳层负责按钮、高亮和面板切换，插件只提供图标、名称和页面。
- 两半都是普通 ESM / 无构建步骤，改完刷新即生效，方便当模板抄。

### 身份与凭据（重要）

DSH 的搜索是 `ctx.web.search(...)`，但**凭据是按身份解析的**：DeepSeek 官方搜索服务只有在
「代表某个 Agent 发起的调用」时才会用你登录的 DeepSeek 账号，否则会去找
`DEEPSEEK_API_KEY` 这类 API Key。

而浏览器发起的 HTTP 路由不在任何对话回合里，天然没有这个身份。所以 Host 半会**借用**
一个 Agent 来执行搜索：

1. 若调用发生在某个回合内，直接用该回合的 Agent；
2. 否则依次尝试当前存活的根 Agent；
3. **只有**报错是「缺少凭据」时才换下一个（这种情况请求还没发出去，不会重复消耗或重复计费），
   其它错误原样返回。

这意味着：用账号登录的机器开箱即用；只配了 API Key 的机器直接走 Key，不借用任何身份。
代价是——同时开多条会话时，这次搜索的请求记录会落在被借用的那条会话日志里（仅记录，不影响结果）。

如果以后要做成「严格归属于你正在看的那条会话」，需要把当前会话 id 从页面传给路由，
再 `agents.withInitiator(agents.get(sessionId), …)`；本 demo 没做这一步。

### 接口

```
GET /dsh-baidu/search?q=<关键词>
```

| 状态 | 含义 |
| --- | --- |
| `200` | `{ query, count, truncated, sources: [{url,title,snippet,publishedAt}] }` |
| `400` | `missing-query`：关键词为空 |
| `403` | `forbidden`：跨站调用 |
| `405` | `method-not-allowed`：非 GET |
| `502` | `search-failed`：搜索服务报错（带 `message`） |
| `503` | `search-unavailable`：本机没有可用的搜索服务 |

## 开发

```sh
npm test          # Host 半的路由契约测试（node:test，无第三方依赖）
```

测试覆盖：路由形状、`maxResults` 上限、结果规范化、截断标记、空关键词、
非 GET、跨站拒绝、无搜索服务、服务报错、以及「每次请求都重新取服务」。

需求澄清版见 [docs/requirements.md](docs/requirements.md)。

## 目录结构

```
dsh-baidu/
├── index.js              # Host 半：搜索路由
├── client.js             # 浏览器半：侧栏入口 + 搜索面板
├── cordis.patch.yml      # 一行 bundle 补丁，同时激活两半
├── locale/{zh,en}.json   # 插件列表里的显示名与描述
├── icon.svg              # 插件图标
├── test/host.test.js     # 路由契约测试
└── docs/requirements.md  # 需求说明（澄清版）
```

## 已知限制（按 demo 定位，非缺陷）

- 只显示前 10 条，不翻页；结果来自搜索服务，顺序即服务返回顺序。
- 不保存搜索历史，切走再回来是空页面。
- 界面文案固定中文，不做运行时多语言切换。
- 搜索结果原样展示，不做摘要合成或安全改写。
- 同时开多条会话时，账号方式下的搜索请求记录会落在被借用的那条会话日志里（见上节）。

## 上架插件市场

市场（`dsh-market`）的插件列表来自精选仓库
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
往那边提一个 PR，加一条指向本仓库的条目，站点和市场的「发现」页会自动收录。
官方市场的索引源（`dsh-plugin-catalog`）同理，走它的提交流程。

## License

[MIT](LICENSE)
