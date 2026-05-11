# lit-search

[![npm](https://img.shields.io/badge/npm-v1.0.3-blue)](https://www.npmjs.com/package/lit-search)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)](package.json)

学术文献检索 CLI / MCP 服务。  
同时检索 `Semantic Scholar`、`OpenAlex`、`arXiv`、`CrossRef`、`CORE`，统一去重、过滤、排序，并为每次检索创建一个结果文件夹，输出 `Markdown`、`BibTeX` 和可下载的 PDF 原文。

当前版本不再输出 JSON 文件，也不再通过 `--format` 选择输出格式。每次检索都会默认生成：

- `results.md`
- `references.bib`
- `pdfs/`

## 特性

- **多数据源**：检索 5 大学术文献数据库（Semantic Scholar、OpenAlex、arXiv、CrossRef、CORE）
- **去重合并**：基于 DOI 和标题相似度自动去除重复文献
- **相关性排序**：按标题/摘要关键词匹配度 + 引用数综合排序
- **查询展开**：支持 `none / pairwise / full` 三种多关键词组合策略，默认只检索原始关键词
- **检索范围控制**：支持 `title-only / title-abstract / default-engine-search` 三种匹配范围
- **固定结果输出**：每次检索自动创建结果文件夹，保存 Markdown 阅读版、BibTeX 引文文件和可下载的 PDF 原文
- **BibTeX 引文导出**：`references.bib` 可直接导入 Zotero / EndNote / Mendeley
- **丰富元数据**：标题、作者、年份、期刊、卷号、期号、页码、DOI、摘要、引用数、PDF 链接、关键词、学科领域、语言、作品类型等
- **PDF 下载诊断**：自动识别无 PDF、非 PDF 页面、403、登录墙、人机核验、限流等情况，并给出下一步建议
- **API Key 管理**：支持 `lit-search init` 交互式保存 key，也支持环境变量覆盖
- **MCP 服务**：内置 stdio MCP 服务，可直接接入 Trae 等 AI 编程工具
- **CLI 兜底集成**：MCP 调试期间，也可让 Trae 直接调用 CLI 命令完成检索
- **跨平台**：支持 Windows、macOS、Linux

## 支持的数据源

| 数据源 | 说明 |
| --- | --- |
| Semantic Scholar | 学术搜索引擎，支持引用数、TLDR、领域信息，开放 PDF 覆盖不稳定 |
| OpenAlex | 字段最丰富，适合补卷号、页码、主题、开放获取链接 |
| arXiv | 预印本，适合获取分类、摘要、PDF |
| CrossRef | DOI 和期刊元数据最稳定，PDF 链接依赖出版社 |
| CORE | 开放获取资源，覆盖面广但字段完整度波动较大 |

## 字段支持对比

说明：

- `✅`：当前代码会提取该字段，且该数据源通常能返回
- `△`：当前代码会提取该字段，但该数据源返回不稳定或覆盖较低
- `❌`：当前数据源通常不提供，或当前实现不输出

| 字段 | Semantic Scholar | OpenAlex | arXiv | CrossRef | CORE |
| --- | :---: | :---: | :---: | :---: | :---: |
| 标题 `title` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 作者 `authors` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 年份 `year` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 期刊/来源 `journal` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 会议 `venue` | ✅ | ✅ | ❌ | △ | △ |
| DOI `doi` | ✅ | ✅ | △ | ✅ | △ |
| 摘要 `abstract` | △ | ✅ | ✅ | △ | △ |
| 引用数 `citation_count` | ✅ | ✅ | ❌ | △ | △ |
| PDF 链接 `pdf_url` | △ | △ | ✅ | △ | △ |
| URL `url` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 卷号 `volume` | △ | ✅ | ❌ | ✅ | △ |
| 期号 `issue` / `number` | △ | ✅ | ❌ | ✅ | △ |
| 页码 `pages` | △ | ✅ | ❌ | ✅ | △ |
| 首页/末页 `first_page` / `last_page` | ❌ | ✅ | ❌ | △ | ❌ |
| 出版商 `publisher` | ❌ | △ | ❌ | ✅ | △ |
| 关键词 `keywords` | △ | ✅ | △ | △ | △ |
| 学科领域 `fields_of_study` | ✅ | ✅ | ❌ | ❌ | △ |
| 主题 `topics` | ❌ | ✅ | ❌ | ❌ | ❌ |
| 语言 `language` | ❌ | ✅ | ❌ | △ | ❌ |
| 作品类型 `work_type` | ✅ | ✅ | ❌ | ✅ | △ |
| TLDR `tldr` | ✅ | ❌ | ❌ | ❌ | ❌ |
| ISSN `issn` | ❌ | △ | ❌ | ✅ | ❌ |
| ISBN `isbn` | ❌ | ❌ | ❌ | △ | ❌ |
| arXiv ID `arxiv_id` | △ | △ | ✅ | ❌ | △ |
| OpenAlex ID `openalex_id` | ❌ | ✅ | ❌ | ❌ | ❌ |
| Semantic Scholar ID `semantic_scholar_id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| CrossRef ID `crossref_id` | ❌ | ❌ | ❌ | ✅ | ❌ |
| CORE ID `core_id` | ❌ | ❌ | ❌ | ❌ | ✅ |
| 主分类 `primary_category` | ❌ | ❌ | ✅ | ❌ | ❌ |

补充说明：

- `OpenAlex` 是当前字段最全的来源。
- `CrossRef` 在 DOI、期刊名、卷号、期号、页码上最稳定。
- `Semantic Scholar` 的摘要和 TLDR 覆盖不稳定，取决于上游记录。
- `arXiv` 本身没有卷号/页码这一类传统期刊元数据。
- `CORE` 会提取更多字段，但原始数据质量波动较大。

## 安装

### 全局安装

```bash
npm install -g lit-search
```

### 本地运行

```bash
npm install
node bin/lit-search.js "machine learning" -l 10
```

## API Key 配置

推荐先执行：

```bash
lit-search init
```

本地源码运行时也可以使用：

```bash
node bin/lit-search.js init
```

会交互式保存以下配置：

- `Semantic Scholar API Key`
- `OpenAlex API Key`
- `CrossRef 联系邮箱`
- `CORE API Key`

配置保存在本机用户配置目录，CLI 和 MCP 都会自动读取。

### 环境变量

无交互场景可直接用环境变量覆盖：

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

### 基本命令

```bash
lit-search "machine learning"
lit-search "AI, agent, coding" -l 5 -s 2023
lit-search "AI, coding, agent" --expand pairwise
lit-search "computer vision" --search-scope title-only
```

### 完整参数

```text
lit-search [关键词] [选项]
lit-search init

选项:
  -l, --limit <n>         每个关键词、每个数据源的检索上限（默认: 3）
  -s, --since <year>      起始年份（包含）
  -u, --until <year>      结束年份（包含）
  --expand <mode>         查询展开策略：none|pairwise|full（默认: none）
  --search-scope <mode>   检索范围：title-only|title-abstract|default-engine-search
  -h, --help              显示帮助
  -v, --version           显示版本
```

每次运行会创建一个结果文件夹，例如：

```text
machinelearning_20260511_153020/
```

文件夹中包含：

```text
results.md
references.bib
pdfs/
```

## 查询展开

`--expand` 控制多关键词查询如何展开：

- `none`：只检索原始关键词，默认策略
- `pairwise`：两两组合 + 单关键词
- `full`：所有组合 + 单关键词

示例输入：

```text
AI, coding, agent
```

展开结果：

- `none` -> `AI`, `coding`, `agent`
- `pairwise` -> `AI coding`, `AI agent`, `coding agent`, `AI`, `coding`, `agent`
- `full` -> `AI coding agent`, `AI coding`, `AI agent`, `coding agent`, `AI`, `coding`, `agent`

## 检索范围

`--search-scope` 控制匹配范围：

- `title-only`
- `title-abstract`
- `default-engine-search`

各源当前实现如下：

| 数据源 | title-only | title-abstract | default-engine-search |
| --- | --- | --- | --- |
| Semantic Scholar | 默认检索后本地过滤 | 默认检索后本地过滤 | 官方默认搜索 |
| OpenAlex | `title.search` | `title_and_abstract.search` | `search` |
| arXiv | `ti:` | `ti:` + `abs:` | 官方默认搜索 |
| CrossRef | `query.title` | `query.bibliographic` + 本地过滤 | `query.bibliographic` |
| CORE | 默认检索后本地过滤 | 默认检索后本地过滤 | 官方默认搜索 |

## 输出格式

当前版本固定输出 Markdown 和 BibTeX，不再输出 JSON 文件。

### Markdown

`results.md` 面向阅读，单篇文献保留这些字段：

- 标题
- 摘要
- 关键词
- 作者，最多显示前三位
- 年份
- 出版物名称，期刊名、会议名等
- 来源
- DOI
- URL
- PDF
- 备注，展示 PDF 下载成功或下载失败原因

### BibTeX

`references.bib` 用于引用管理软件或论文写作。

条目类型推断规则：

- 有 `journal` -> `@article`
- 无 `journal` 但有 `venue` / `booktitle` -> `@inproceedings`
- arXiv -> `@misc`
- 其他 -> `@misc`

常见字段：

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
- `language`
- `note`
- `source`
- `citationcount`
- `pdfurl`
- `eprint`
- `archiveprefix`
- `primaryclass`

## PDF 下载

工具会在文献存在 `pdf_url` 时尝试下载 PDF。只有 HTTP 响应能验证为真实 PDF 时才会保存文件。

| 数据源 | PDF 支持 | 说明 |
| --- | --- | --- |
| arXiv | 稳定 | 根据 arXiv ID 构造 PDF URL |
| Semantic Scholar | 部分 | 使用 `openAccessPdf.url` |
| OpenAlex | 部分 | 优先选择仓储、arXiv、PMC、CORE、Zenodo 等开放位置，其次才尝试 publisher 链接 |
| CrossRef | 部分 | 使用 `link[]` 中 content type 包含 PDF 的链接 |
| CORE | 部分 | 使用 `downloadUrl` |

常见失败原因：

- `human_verification_required`：需要浏览器人机核验。
- `access_denied_or_bot_check`：服务器拒绝自动化下载，可能是反爬或防盗链。
- `authentication_required`：需要登录或机构权限。
- `payment_or_subscription_required`：需要订阅或付费。
- `not_direct_pdf`：链接返回的是 HTML 落地页，不是 PDF。
- `rate_limited`：对方限流。

需要人机核验的页面不应绕过。推荐做法是寻找 arXiv、CORE、PubMed Central、Zenodo、机构仓储等开放版本，或由用户在浏览器中手动登录/核验后下载。

## 结果统计与过滤

终端中的统计示例：

```text
原始检索: 15 篇
去重后: 14 篇
过滤后: 11 篇
```

含义：

- `原始检索`：所有启用文献源返回的总数。
- `去重后`：按 DOI 和标题相似度去重后的数量。
- `过滤后`：二次相关性过滤后的数量。

过滤规则：

- 标题命中关键词，相关性分数 `+3`。
- 标题未命中但摘要命中关键词，相关性分数 `+1`。
- 如果设置排除词，标题或摘要命中排除词会被过滤。
- 有关键词时，只保留相关性分数大于 `0` 的文献。

## MCP 服务

项目内置 `stdio` MCP 服务：

```bash
lit-search-mcp
```

或：

```bash
node bin/lit-search-mcp.js
```

当前提供工具：

- `search_literature`

参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 搜索词。多个概念请用逗号分隔，例如 `ontology, knowledge graph, semantic web` |
| `limit` | number | 每个关键词、每个数据源的检索上限 |
| `yearStart` | number | 起始年份 |
| `yearEnd` | number | 结束年份 |
| `queryExpansion` | string | `none` / `pairwise` / `full` |
| `searchScope` | string | `title-only` / `title-abstract` / `default-engine-search` |

MCP 和 CLI 使用同一个底层 workflow。调用后会创建结果文件夹、下载 PDF、写入 `results.md` 和 `references.bib`，并返回 Markdown、BibTeX、结构化文献数据、输出路径和 PDF 下载诊断。

Agent 调用 MCP 后应优先查看：

- `structuredContent.output.outputDir`：本次检索结果文件夹
- `structuredContent.output.markdownFile`：Markdown 阅读版
- `structuredContent.output.bibFile`：BibTeX 引文文件，可导入 Zotero / EndNote / Mendeley
- `structuredContent.output.pdfDir`：PDF 原文下载目录
- `structuredContent.pdfSummary`：PDF 下载成功/失败统计与原因

工具返回的第一段文本也会直接列出这些路径，避免 agent 只关注结构化元数据而忽略本地文件。

### 给 Agent 的调用建议

不要把多个独立概念写成一个空格分隔的长短语。例如不推荐：

```json
{
  "query": "ontology knowledge graph semantic web",
  "limit": 10
}
```

更推荐使用逗号分隔：

```json
{
  "query": "ontology, knowledge graph, semantic web",
  "limit": 5,
  "queryExpansion": "none",
  "searchScope": "default-engine-search"
}
```

经验规则：

- 多个独立概念必须在 `query` 中用逗号分隔，和 CLI 保持一致。
- `limit` 是“每个关键词、每个数据源”的上限，通常 `3` 到 `5` 就够做初筛。
- 默认 `queryExpansion: "none"` 更稳；只有需要组合概念时再用 `pairwise`。
- `title-only` 很严格，容易漏结果；一般先用 `default-engine-search`。
- 如果严格相关性过滤后没有结果，工具会自动尝试单词级宽松过滤，并在 `metadata.filterMode` 中标记为 `relaxed`。

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

如果 `node` 不在 PATH 中，可以把 `command` 改成绝对路径。  
如果已经通过 `lit-search init` 保存 API Key，`env` 中不需要再写 key。

MCP 调试日志文件：

```text
D:\lit-search\temp\mcp-debug.log
```

如果 Trae 一直显示“准备中”，可以检查该日志：

- 出现 `startup sdk` 和 `server connected`：MCP 服务已启动并连接 stdio transport。
- 出现 `tool search_literature args=...`：Trae 已经成功调用检索工具。
- 出现 `tool search_literature done papers=...`：工具调用完成并返回结果。
- 出现 `transport error`：stdio 协议或客户端消息格式异常。

### Trae CLI 命令兜底

如果 MCP 仍在调试，可以先让 Trae 直接运行 CLI。它与 MCP 使用同一个 workflow，也会生成相同的结果文件夹。

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

命令完成后，打开最新生成的结果文件夹，阅读 results.md。references.bib 用于引用导出，PDF 原文在 pdfs 子文件夹中。如果 PDF 下载失败，查看 results.md 的“备注”字段，其中包含失败原因和下一步建议。
```

## 测试与诊断

```bash
# 基础帮助输出检查
npm test

# 完整验收测试
npm run test:acceptance

# 网络 / API 诊断
npm run diagnose
```

## 现状说明

- `Semantic Scholar` 年份过滤当前已修正为官方接受的区间格式。
- `arXiv` 当前直接走 `https` 请求，并绕开了 Node `fetch` 的连接超时问题。
- `arXiv` 的年份条件会下推到 API 查询，避免先取前几条再本地过滤导致结果不足。
- `OpenAlex` 提供的是 PDF 线索，不保证目标 PDF 能被程序直接下载。
- 外部源仍可能因为限流、网络路径或服务端波动返回 `429` / `5xx` / 超时，这不一定是本地代码问题。

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
