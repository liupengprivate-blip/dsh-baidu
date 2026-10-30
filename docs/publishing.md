# 发布与上架

记录「发布到 GitHub」和「让 dsh-market 搜到」的确切步骤与现状。

## 1. 已完成

| 项 | 状态 |
| --- | --- |
| GitHub 仓库 | <https://github.com/liupengprivate-blip/dsh-baidu>（public，MIT） |
| 仓库 topics | `dsh-plugin`、`dsh`、`deepseek-harness`、`dsh-baidu` |
| 提交作者 | 已重写为 GitHub 身份（`<id>+liupengprivate-blip@users.noreply.github.com`） |
| 从 GitHub 安装 | 已实测：`github:liupengprivate-blip/dsh-baidu` 装进 profile 后搜索返回 10 条 |
| npm 包 `dsh-baidu` | **已被他人占用**（`dushaobindoudou`，只有 0.0.1 占位版），本版不发布 npm |

安装方式（发布后用户实际执行的命令）：

```sh
dsh plugin --profile web add github:liupengprivate-blip/dsh-baidu
```

## 2. 日常发版流程

```sh
# 1. 改代码、跑测试
npm test

# 2. 升版本号（package.json 的 version）
# 3. 提交并推送
git add -A
git commit -m "feat: ..."
git push

# 4. 打 tag（可选，便于固定版本安装）
git tag v0.1.0 && git push --tags
```

## 3. 让 dsh-market 搜到

`dsh-market` 的插件列表来自精选仓库
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
**不要手工改它的 README** —— 列表数据在 `data/plugins/`，一个插件一个 YAML 文件，
README 由脚本生成。

### 前置条件（清单）

- [x] `package.json` 声明了 `dsh.bundle`（`{ "bundle": { "patch": "./cordis.patch.yml" } }`）
- [x] 仓库根目录有 `cordis.patch.yml`
- [x] 仓库加了 `dsh-plugin` topic
- [x] 仓库是真实可用的代码
- [ ] **仓库创建满 1 天** —— 由对方 CI 自动检查，刚建好就提会被 CI 卡住

因为本仓库是当天创建的，**建议满 24 小时后再提 PR**；提前提只会看到 CI 的 repo-age 失败。

### 要提交的文件

新增一个文件 `data/plugins/liupengprivate-blip__dsh-baidu.yml`：

```yaml
url: https://github.com/liupengprivate-blip/dsh-baidu
name: liupengprivate-blip/dsh-baidu
category: ui
description:
  en: A simulated search engine page in the DSH sidebar that queries the local web search API and lists the top 10 results.
  zh: DSH 侧栏里的模拟搜索页：调用本地搜索接口，列出前 10 条结果。
```

分类取值见对方 `contributing.md`，`ui` 最贴合；选偏了维护者会直接改，不会打回。

### 提交 PR 的命令

```sh
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone --remote
cd awesome-dsh-plugin
cat > data/plugins/liupengprivate-blip__dsh-baidu.yml <<'YAML'
url: https://github.com/liupengprivate-blip/dsh-baidu
name: liupengprivate-blip/dsh-baidu
category: ui
description:
  en: A simulated search engine page in the DSH sidebar that queries the local web search API and lists the top 10 results.
  zh: DSH 侧栏里的模拟搜索页：调用本地搜索接口，列出前 10 条结果。
YAML
git checkout -b add-dsh-baidu
git add data/plugins/liupengprivate-blip__dsh-baidu.yml
git commit -m "Add liupengprivate-blip/dsh-baidu"
git push -u origin add-dsh-baidu
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add liupengprivate-blip/dsh-baidu" \
  --body "搜索引擎模拟器：DSH 侧栏入口 + 模拟搜索页，调用本地搜索接口列出前 10 条结果。"
```

### 关键词为什么能命中

- 仓库名与 `package.json` 的 `name` 都是 `dsh-baidu`
- `package.json` 的 `keywords` 里也包含 `dsh-baidu`
- 仓库 topic 里有 `dsh-baidu`
- 市场对包名、标题、描述、关键词做模糊匹配，所以搜 `dsh-baidu` 能命中

### 关于「发现」索引

官方「发现」索引只收录**已在 npm 发布且有已知版本**的插件；仅 GitHub 的条目会出现在精选列表里、
可安装，但不进那份索引。本项目暂走精选列表这条路。

## 4. 将来要进 npm 索引怎么办

npm 上的 `dsh-baidu` 被占用，有两条出路：

1. 换一个可用包名（如 `dsh-baidu-demo`）发布 —— 安装命令随之变化；
2. 用自己的 npm scope 发布（`@liupengprivate-blip/dsh-baidu`）。

两种都需要同步改 `package.json` 的 `name`、README 的安装命令，以及本文件第 3 节的 YAML `name`。

## 5. 发布前自检

```sh
npm test                 # 16 个路由契约测试
node --check index.js    # Host 半语法
node --check client.js   # 浏览器半语法
curl "http://127.0.0.1:<port>/dsh-baidu/search?q=test"   # 应返回 200 + 最多 10 条
```
