# 发布与上架

这份文档记录「发布到 GitHub」和「让 dsh-market 搜到」的确切步骤与现状。

## 1. 现状

| 项 | 状态 |
| --- | --- |
| 本地 git 仓库（`main` 分支） | 已初始化并提交 |
| GitHub 仓库 `liupengprivate-blip/dsh-baidu` | 见下文 |
| npm 包 `dsh-baidu` | **已被他人占用**，无法发布该名字 |
| dsh-market / 插件市场 | 需通过 awesome-dsh-plugin 列表收录 |

## 2. 推到 GitHub

```sh
git remote add origin https://github.com/liupengprivate-blip/dsh-baidu.git
git push -u origin main
```

用 GitHub CLI 建仓并推送（一步到位）：

```sh
gh repo create dsh-baidu --public --source=. --remote=origin --push \
  --description "搜索引擎模拟器 — DSH 侧栏搜索面板插件"
```

或先在网页上建一个空的 public 仓库，再执行上面的 `git remote add` + `git push`。

> 本仓库首次提交使用的身份是占位身份（`dsh-baidu <dsh-baidu@users.noreply.github.com>`）。
> 想让提交归属到你的 GitHub 账号，先设置邮箱再重写：
>
> ```sh
> git config user.name  "你的名字"
> git config user.email "你的 GitHub 邮箱"
> git commit --amend --reset-author --no-edit
> git push -f -u origin main
> ```

## 3. 让 dsh-market 搜到（关键词 `dsh-baidu`）

`dsh-market` 的插件列表来自精选仓库
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)；
该列表同时被导出为 format 1 的「发现」索引（npm 上的 `dsh-plugin-catalog`）。

两条收录路径：

1. **精选列表（GitHub 条目）**：往 awesome-dsh-plugin 提 PR，按它的分类加一条，
   安装命令写 `dsh plugin --profile web add github:liupengprivate-blip/dsh-baidu`。
   列表明确接受「仅 GitHub」的条目，dsh-market 的市场页就能搜到并一键安装。
2. **「发现」索引（需要 npm）**：官方索引只收录「已在 npm 发布且有已知版本」的插件。
   本项目暂不走这条路，因为 npm 上的 `dsh-baidu` 已被第三方占用（只有一个 0.0.1 占位版本）。
   将来若要进索引，需要换一个可用的包名（如 `dsh-baidu-demo`）或用自己的 npm scope 发布，
   再更新本仓库 `package.json` 的 `name`。

### 关键词为什么能命中

- `package.json` 的 `name` 是 `dsh-baidu`
- `keywords` 里同时包含 `dsh-baidu`
- 插件的显示名是「搜索引擎模拟器」，描述里带 `dsh-baidu`

市场的搜索对包名、标题、描述、关键词做模糊匹配，所以搜 `dsh-baidu` 能命中。

### PR 条目草稿

```md
- [dsh-baidu](https://github.com/liupengprivate-blip/dsh-baidu) — 搜索引擎模拟器：左侧栏入口 +
  模拟搜索页，调用 DSH 本地搜索接口列出前 10 条结果。`dsh plugin --profile web add github:liupengprivate-blip/dsh-baidu`
```

（分类建议：`UI 增强` / `浏览器与网页`。实际格式以该仓库 `CONTRIBUTING` 为准。）

## 4. 发布前自检

```sh
npm test                     # 16 个路由契约测试
node --check index.js        # Host 半语法
node --check client.js       # 浏览器半语法
```

安装后验证：

```sh
curl "http://127.0.0.1:<port>/dsh-baidu/search?q=test"   # 应返回 200 + 10 条结果
```
