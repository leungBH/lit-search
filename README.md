# lit-search

[![npm](https://img.shields.io/npm/v/lit-search?label=npm)](https://www.npmjs.com/package/lit-search)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)](package.json)

面向研究和写作场景的学术文献检索 CLI / MCP 服务。

`lit-search` 可以同时检索 Semantic Scholar、OpenAlex、arXiv、CrossRef 和 CORE，自动去重、过滤、排序，并为每次检索生成一个文献池文件夹。默认只保存文献结果，不自动下载 PDF；PDF 下载、状态统计、批量合并和引文反查可以分阶段执行。

## 特性

- **多数据源检索**：聚合 Semantic Scholar、OpenAlex、arXiv、CrossRef、CORE。
- **去重合并**：基于 DOI 和标题相似度去除重复文献。
- **相关性排序**：结合标题/摘要关键词匹配度和引用数排序。
- **多关键词策略**：支持原词检索、两两组合、全组合。
- **检索范围控制**：支持标题检索、标题+摘要检索、各数据源默认检索。
- **文献池输出**：每次检索自动生成 `literature_pool.md`、`literature_pool.json`、`references.bib`、`pdf_status.md` 和 `pdfs/`。
- **BibTeX 导出**：可导入 Zotero、EndNote、Mendeley 或 LaTeX 工作流。
- **分阶段 PDF 下载**：默认不下载 PDF；显式执行 `lit-search pdf` 或 `--pdf` 后才下载，并记录下载成功、无 PDF、登录墙、人机核验、非 PDF 页面、限流等情况。
- **文献池管理**：支持 `status`、`merge` 和 `resolve`，可统计 PDF 状态、合并多批检索结果、从参考文献条目反查文献。
- **MCP 服务**：可接入 Trae 等支持 MCP 的 AI 编程工具。
- **Skills 支持**：内置面向智能体的 `lit-search` Skill，帮助 Codex 等客户端正确拆分关键词、调用 MCP/CLI 并读取输出文件。
- **跨平台**：支持 Windows、macOS、Linux。

## 快速开始

### 安装

全局安装：

```bash
npm install -g lit-search
```

本地源码运行：

```bash
git clone https://github.com/leungBH/lit-search.git
cd lit-search
npm install
node bin/lit-search.js "machine learning" -l 5 -s 2022
```

### 配置 API Key

推荐使用交互式配置：

```bash
lit-search init
```

本地源码运行时：

```bash
node bin/lit-search.js init
```

可配置项：

- Semantic Scholar API Key
- OpenAlex API Key
- CrossRef 联系邮箱
- CORE API Key

也可以通过环境变量覆盖本地配置：

```bash
LIT_SEARCH_S2_API_KEY
LIT_SEARCH_OPENALEX_API_KEY
LIT_SEARCH_CROSSREF_MAILTO
LIT_SEARCH_CORE_API_KEY
```

PowerShell 示例：

```powershell
$env:LIT_SEARCH_S2_API_KEY="your-semantic-scholar-api-key"
$env:LIT_SEARCH_OPENALEX_API_KEY="your-openalex-api-key"
$env:LIT_SEARCH_CROSSREF_MAILTO="your-email@example.com"
$env:LIT_SEARCH_CORE_API_KEY="your-core-api-key"
```

## CLI 用法

```bash
lit-search "machine learning"
lit-search search "machine learning"
lit-search "AI, coding, agent" -l 5 -s 2023
lit-search "AI, coding, agent" --pdf
lit-search pdf .\lit_search_20260518_153020
lit-search status .\lit_search_20260518_153020
lit-search merge .\batch1 .\batch2 -o .\merged
lit-search resolve .\citations.txt --output-dir .\resolved
lit-search "AI, coding, agent" --expand pairwise
lit-search "computer vision" --search-scope title-only
lit-search "machine learning" --output-dir ./results
```

完整参数：

```text
lit-search [query] [options]
lit-search search [query] [options]
lit-search pdf <pool-folder|literature_pool.json|pdf_status.md>
lit-search status <pool-folder|literature_pool.json|pdf_status.md>
lit-search merge <pool...> -o <output-dir>
lit-search resolve <citations.txt> [options]
lit-search init

Options:
  -l, --limit <n>          每个关键词、每个数据源的检索上限，默认 3
  -s, --since <year>       起始年份，包含该年
  -u, --until <year>       结束年份，包含该年
  --expand <mode>          查询展开策略：none|pairwise|full，默认 none
  --search-scope <mode>    检索范围：title-only|title-abstract|default-engine-search
  --output-dir <dir>       生成结果文件夹的父目录
  --pdf                    检索落盘后继续下载 PDF
  --no-pdf                 不下载 PDF，默认行为
  -h, --help               显示帮助
  -v, --version            显示版本
```

> `limit` 是“每个关键词、每个数据源”的上限，不是最终结果数量上限。默认 `lit-search "query"` 等价于 `lit-search search "query"`，只生成文献池，不自动下载 PDF。

## 多关键词与查询展开

多个关键词用英文逗号分隔：

```bash
lit-search "ontology, knowledge graph, semantic web" -l 5
```

`--expand` 控制多关键词如何组合：

| 策略 | 说明 | 示例输入 `AI, coding, agent` |
| --- | --- | --- |
| `none` | 只检索原始关键词 | `AI`、`coding`、`agent` |
| `pairwise` | 两两组合 + 原始关键词 | `AI coding`、`AI agent`、`coding agent`、`AI`、`coding`、`agent` |
| `full` | 全组合 + 两两组合 + 原始关键词 | `AI coding agent`、`AI coding`、`AI agent`、`coding agent`、`AI`、`coding`、`agent` |

默认使用 `none`，适合大多数场景。

## 检索范围

`--search-scope` 控制各数据源的检索范围：

| 数据源 | `title-only` | `title-abstract` | `default-engine-search` |
| --- | --- | --- | --- |
| Semantic Scholar | 默认检索后本地标题过滤 | 默认检索后本地标题/摘要过滤 | 官方默认检索 |
| OpenAlex | `title.search` | `title_and_abstract.search` | `search` |
| arXiv | `ti:` | `ti:` + `abs:` | 官方默认检索 |
| CrossRef | `query.title` | `query.bibliographic` + 本地过滤 | `query.bibliographic` |
| CORE | 默认检索后本地标题过滤 | 默认检索后本地标题/摘要过滤 | 官方默认检索 |

一般建议先使用默认的 `default-engine-search`，需要更严格结果时再切换到 `title-only`。

## 输出结果

每次 search 都会创建一个文献池文件夹。默认保存在当前目录，也可以通过 `--output-dir <dir>` 指定父目录，例如：

```text
results/lit_search_20260518_153020/
```

目录结构：

```text
lit_search_20260518_153020/
├── literature_pool.md
├── literature_pool.json
├── references.bib
├── pdf_status.md
├── search_meta.json
├── results.md
└── pdfs/
```

### `literature_pool.md`

面向阅读的 Markdown 文献池文件。每篇文献保留：

- 标题
- 摘要
- 关键词
- 作者，最多显示前三位
- 年份
- 出版物名称
- 来源
- DOI
- URL
- PDF 链接
- 备注，展示 PDF 是否已下载、未尝试或失败原因

`results.md` 目前作为兼容别名继续生成，内容与 `literature_pool.md` 一致。

示例：

```text
- PDF: https://arxiv.org/pdf/2404.14450v1.pdf
- 备注: PDF 下载成功
```

```text
- PDF: https://example.com/paper.pdf
- 备注: PDF 下载失败：human_verification_required。The PDF URL appears to require browser-based human verification before access.
```

### `references.bib`

BibTeX 引文文件，可导入 Zotero、EndNote、Mendeley，也可用于 LaTeX。

常见字段包括：

- `title`
- `author`
- `year`
- `journal`
- `booktitle`
- `volume`
- `number`
- `pages`
- `publisher`
- `doi`
- `url`
- `abstract`
- `keywords`
- `pdfurl`
- `eprint`
- `archiveprefix`
- `primaryclass`

### `pdf_status.md`

独立记录 PDF 状态，适合用户和智能体查看：

- `downloaded`
- `not_attempted`
- `missing_url`
- `failed`
- `skipped`

### `pdfs/`

保存成功下载的 PDF 原文。默认 search 不会下载 PDF；运行 `lit-search pdf <pool>` 或 search 时加 `--pdf` 才会写入文件。失败原因会记录在 `pdf_status.md` 和 MCP 的 `pdfSummary` 中。

## PDF 下载说明

`lit-search` 只会在响应可验证为真实 PDF 时保存文件，避免把 HTML 落地页误存为 PDF。

| 数据源 | PDF 支持 | 说明 |
| --- | --- | --- |
| arXiv | 稳定 | 根据 arXiv ID 构造 PDF URL |
| Semantic Scholar | 部分支持 | 使用 `openAccessPdf.url` |
| OpenAlex | 部分支持 | 优先选择仓储、arXiv、PMC、CORE、Zenodo 等开放位置 |
| CrossRef | 部分支持 | 使用 `link[]` 中 content type 包含 PDF 的链接 |
| CORE | 部分支持 | 使用 `downloadUrl` |

常见失败原因：

| 原因 | 含义 |
| --- | --- |
| `no_pdf_url` | 数据源没有提供 PDF 链接 |
| `not_direct_pdf` | 链接返回 HTML 落地页，不是直接 PDF |
| `human_verification_required` | 需要浏览器人机核验 |
| `access_denied_or_bot_check` | 服务器拒绝自动化下载，可能是反爬或防盗链 |
| `authentication_required` | 需要登录或机构权限 |
| `payment_or_subscription_required` | 需要订阅或付费 |
| `rate_limited` | 对方限流 |

需要人机核验或登录的页面不应绕过。建议寻找 arXiv、CORE、PubMed Central、Zenodo、机构仓储等开放版本，或由用户在浏览器中手动处理。

## 支持的数据源与字段

| 数据源 | 说明 |
| --- | --- |
| Semantic Scholar | 引用数、TLDR、研究领域较好，摘要和 PDF 覆盖不稳定 |
| OpenAlex | 元数据最丰富，适合补卷号、页码、主题和开放获取链接 |
| arXiv | 预印本，PDF 链接稳定，适合获取分类和摘要 |
| CrossRef | DOI、期刊名、卷期页等出版信息稳定 |
| CORE | 开放获取资源覆盖广，但元数据质量波动较大 |

字段支持概览：

| 字段 | Semantic Scholar | OpenAlex | arXiv | CrossRef | CORE |
| --- | :---: | :---: | :---: | :---: | :---: |
| 标题、作者、年份 | 是 | 是 | 是 | 是 | 是 |
| 期刊/出版物 | 是 | 是 | 是 | 是 | 是 |
| DOI | 是 | 是 | 部分 | 是 | 部分 |
| 摘要 | 部分 | 是 | 是 | 部分 | 部分 |
| 关键词 | 部分 | 是 | 部分 | 部分 | 部分 |
| 引用数 | 是 | 是 | 否 | 部分 | 部分 |
| 卷号、期号、页码 | 部分 | 是 | 否 | 是 | 部分 |
| PDF URL | 部分 | 部分 | 是 | 部分 | 部分 |

## MCP 服务

启动 MCP 服务：

```bash
lit-search-mcp
```

本地源码运行：

```bash
node bin/lit-search-mcp.js
```

提供工具：

```text
search_literature
```

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 搜索词。多个关键词用逗号分隔，例如 `ontology, knowledge graph, semantic web` |
| `limit` | number | 每个关键词、每个数据源的检索上限 |
| `yearStart` | number | 起始年份 |
| `yearEnd` | number | 结束年份 |
| `queryExpansion` | string | `none` / `pairwise` / `full` |
| `searchScope` | string | `title-only` / `title-abstract` / `default-engine-search` |
| `outputDir` | string | 生成结果文件夹的父目录；仍会自动创建时间戳结果子文件夹 |
| `downloadPdf` | boolean | 是否立即下载 PDF，默认 `false` |

MCP 和 CLI 使用同一个底层 workflow。调用后会创建文献池文件夹，写入 `literature_pool.md`、`literature_pool.json`、`references.bib`、`pdf_status.md` 和 `search_meta.json`，并返回 Markdown、BibTeX、结构化文献数据、输出路径和 PDF 状态。默认不下载 PDF；需要一体化下载时传 `downloadPdf: true`。一次 workflow 会并发检索已启用的数据源，但同一数据源内的多个关键词仍会串行请求，以降低触发上游 API 限制的风险。

Agent 调用后应优先查看：

- `structuredContent.output.outputDir`
- `structuredContent.output.literaturePoolFile`
- `structuredContent.output.markdownFile`
- `structuredContent.output.bibFile`
- `structuredContent.output.pdfStatusFile`
- `structuredContent.output.poolJsonFile`
- `structuredContent.output.pdfDir`
- `structuredContent.pdfSummary`

工具返回的第一段文本也会直接列出 Markdown、BibTeX 和 PDF 目录路径。

## 通过 Skills 使用

仓库内置了一个面向智能体的 Skill：

```text
skills/lit-search/SKILL.md
```

这个 Skill 不负责执行检索，而是告诉 Codex 等支持 Skills 的客户端：什么时候应该使用 `lit-search`、多个关键词如何用英文逗号分隔、优先调用哪个 MCP 工具、MCP 不可用时如何回退 CLI，以及检索完成后应该读取哪些输出文件。

### 安装到 Codex 客户端

本地源码仓库中，可以用 PowerShell 复制：

```powershell
Copy-Item -Recurse -Force .\skills\lit-search "$env:USERPROFILE\.codex\skills\lit-search"
```

如果是从 npm 全局安装后想复制 Skill，可以先查看全局包路径：

```powershell
npm root -g
```

然后把其中的 `lit-search\skills\lit-search` 复制到：

```text
C:\Users\<你的用户名>\.codex\skills\lit-search
```

安装后重启 Codex 客户端。之后可以这样提问：

```text
帮我检索 ontology, knowledge graph, semantic web 相关论文，2020 年以后，每个关键词每个数据源 5 篇，保存 BibTeX 和 PDF。
```

Skill 会引导智能体优先调用 MCP 的 `search_literature`，并在结果生成后查看：

- `literature_pool.md`
- `literature_pool.json`
- `references.bib`
- `pdf_status.md`
- `pdfs/`
- PDF 下载备注或 `pdfSummary`

### Agent 调用建议

不要把多个独立概念写成一个空格分隔的长短语。

不推荐：

```json
{
  "query": "ontology knowledge graph semantic web",
  "limit": 10
}
```

推荐：

```json
{
  "query": "ontology, knowledge graph, semantic web",
  "limit": 5,
  "queryExpansion": "none",
  "searchScope": "default-engine-search",
  "outputDir": "D:/lit-search-results",
  "downloadPdf": false
}
```

经验规则：

- 多个关键词必须在 `query` 中用逗号分隔，和 CLI 保持一致。
- `limit` 通常设置为 `3` 到 `5` 就够做初筛。
- 默认 `queryExpansion: "none"` 更稳。
- `title-only` 很严格，容易漏结果；一般先用 `default-engine-search`。
- lit-search 单次调用内部已经会并发检索多个文献源；同一个研究请求不要拆成多个子任务并发调用 MCP/CLI。
- 多个独立主题建议顺序执行；如果确实要并发，应先确认用户接受上游 API 限制风险。

### Trae 配置示例

项目级 `.trae/mcp.json`：

```json
{
  "mcpServers": {
    "lit-search": {
      "type": "stdio",
      "command": "C:\\nvm4w\\nodejs\\node.exe",
      "args": ["D:\\lit-search\\bin\\lit-search-mcp.js"],
      "cwd": "D:\\lit-search",
      "env": {
        "LIT_SEARCH_MCP_DEBUG": "1"
      }
    }
  }
}
```

如果已经通过 `lit-search init` 保存 API Key，`env` 中不需要再写 key。

调试日志：

```text
D:\lit-search\temp\mcp-debug.log
```

常见日志含义：

- `startup sdk` / `server connected`：MCP 服务启动成功。
- `tool search_literature args=...`：Trae 已经调用检索工具。
- `tool search_literature done papers=...`：工具调用完成。
- `transport error`：客户端消息格式或 stdio 通信异常。

### Trae CLI 兜底方案

如果 MCP 仍在调试，可以让 Trae 直接运行 CLI：

```powershell
cd D:\lit-search
C:\nvm4w\nodejs\node.exe .\bin\lit-search.js "machine learning" -l 3 -s 2022
```

多关键词：

```powershell
cd D:\lit-search
C:\nvm4w\nodejs\node.exe .\bin\lit-search.js "AI, coding, agent" -l 3 -s 2023
```

可以给 Trae 这样的指令：

```text
当我要求检索学术文献时，请在 D:\lit-search 下运行：
C:\nvm4w\nodejs\node.exe .\bin\lit-search.js "<query>" -l <limit> -s <year>

命令完成后，打开最新生成的结果文件夹，阅读 literature_pool.md。references.bib 用于引用导出，pdf_status.md 用于查看 PDF 状态；需要下载 PDF 时再运行 lit-search pdf <结果文件夹>。PDF 原文在 pdfs 子文件夹中。
```

## 测试

```bash
npm test
npm run test:acceptance
npm run diagnose
```

## 发版前检查

```bash
node test.js
npm pack --dry-run
```

如果当前版本已经发布过，需要先升级版本：

```bash
npm version patch
```

## 项目结构

```text
lit-search/
├── bin/
│   ├── lit-search.js
│   └── lit-search-mcp.js
├── lib/
│   ├── app-config.js
│   ├── logger.js
│   ├── output.js
│   ├── output-files.js
│   ├── pdf-downloader.js
│   ├── search.js
│   ├── workflow.js
│   └── apis/
│       ├── index.js
│       ├── semantic-scholar.js
│       ├── openalex.js
│       ├── arxiv.js
│       ├── crossref.js
│       ├── core.js
│       └── request-utils.js
├── diagnose.js
├── test.js
├── package.json
└── README.md
```

## License

MIT
