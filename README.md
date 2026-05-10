# lit-search

学术文献检索 CLI / MCP 服务。  
同时检索 `Semantic Scholar`、`OpenAlex`、`arXiv`、`CrossRef`、`CORE`，统一去重、排序，并输出 `Markdown`、`JSON`、`BibTeX`。

## 功能概览

- 多数据源并行检索
- DOI + 标题相似度去重
- `none / pairwise / full` 查询展开
- `title-only / title-abstract / default-engine-search` 检索范围控制
- 输出格式：`md`、`json`、`bib`
- 交互式初始化：`lit-search init`
- 内置 `stdio` MCP 服务：`lit-search-mcp`

## 支持的数据源

| 数据源 | 说明 |
| --- | --- |
| Semantic Scholar | 学术搜索引擎，支持引用数、TLDR、领域信息 |
| OpenAlex | 字段最丰富，适合补卷号、页码、主题、开放获取链接 |
| arXiv | 预印本，适合获取分类、摘要、PDF |
| CrossRef | DOI 和期刊元数据最稳定 |
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
| PDF 链接 `pdf_url` | ✅ | ✅ | ✅ | △ | △ |
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
lit-search "graph neural network" --format json
lit-search "retrieval augmented generation" --format bib
```

### 完整参数

```text
lit-search [关键词] [选项]
lit-search init

选项:
  -l, --limit <n>         每个关键词、每个数据源的检索上限（默认: 3）
  -s, --since <year>      起始年份（包含）
  -u, --until <year>      结束年份（包含）
  --format <mode>         输出格式：md|json|bib（默认: md）
  --expand <mode>         查询展开策略：none|pairwise|full（默认: none）
  --search-scope <mode>   检索范围：title-only|title-abstract|default-engine-search
  -h, --help              显示帮助
  -v, --version           显示版本
```

## 查询展开

`--expand` 控制多关键词查询如何展开：

- `none`：只检索原始关键词
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
| Semantic Scholar | 默认检索后本地过滤 | 基本等同默认搜索 | 官方默认搜索 |
| OpenAlex | `title.search` | `title_and_abstract.search` | `search` |
| arXiv | `ti:` | `ti:` + `abs:` | 官方默认搜索 |
| CrossRef | `query.title` | `query.bibliographic` + 本地过滤 | `query.bibliographic` |
| CORE | 默认检索后本地过滤 | 默认检索后本地过滤 | 官方默认搜索 |

## 输出格式

### Markdown

默认输出。包含：

- 查询摘要
- 各引擎统计
- 每篇文献的详细字段列表

### JSON

结构包含两部分：

- `metadata`
- `papers`

单篇文献对象当前可能包含这些字段：

```json
{
  "citation_key": "Smith2024_1",
  "entry_type": "article",
  "title": "Paper Title",
  "author": "Alice Smith and Bob Lee",
  "authors": ["Alice Smith", "Bob Lee"],
  "year": 2024,
  "journal": "Journal Name",
  "venue": "Conference Name",
  "booktitle": null,
  "volume": "12",
  "number": "3",
  "issue": "3",
  "pages": "101-120",
  "first_page": "101",
  "last_page": "120",
  "publisher": "Publisher",
  "note": null,
  "doi": "10.xxxx/xxxxx",
  "url": "https://...",
  "pdf_url": "https://...pdf",
  "abstract": "Abstract...",
  "keywords": ["keyword1", "keyword2"],
  "topics": ["topic1"],
  "fields_of_study": ["Computer Science"],
  "isbn": null,
  "issn": ["1234-5678"],
  "arxiv_id": "2401.12345",
  "openalex_id": "https://openalex.org/W1234",
  "semantic_scholar_id": "abc123",
  "crossref_id": "10.xxxx/xxxxx",
  "core_id": 12345,
  "primary_category": "cs.AI",
  "language": "en",
  "work_type": "Article",
  "source": "openalex",
  "citation_count": 100,
  "relevance_score": 3,
  "seq_id": 1
}
```

### BibTeX

`--format bib` 输出 `.bib` 文件。

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
| `query` | string | 搜索词，多个关键词用逗号分隔 |
| `limit` | number | 每个关键词、每个数据源的检索上限 |
| `yearStart` | number | 起始年份 |
| `yearEnd` | number | 结束年份 |
| `format` | string | `md` / `json` / `bib` |
| `queryExpansion` | string | `none` / `pairwise` / `full` |
| `searchScope` | string | `title-only` / `title-abstract` / `default-engine-search` |

### Trae 配置示例

项目级 `.trae/mcp.json`：

```json
{
  "mcpServers": {
    "lit-search": {
      "command": "node",
      "args": ["D:\\lit-search\\bin\\lit-search-mcp.js"],
      "env": {
        "LIT_SEARCH_S2_API_KEY": "your-semantic-scholar-api-key",
        "LIT_SEARCH_OPENALEX_API_KEY": "your-openalex-api-key",
        "LIT_SEARCH_CROSSREF_MAILTO": "your-email@example.com",
        "LIT_SEARCH_CORE_API_KEY": "your-core-api-key"
      }
    }
  }
}
```

如果 `node` 不在 PATH 中，可以把 `command` 改成绝对路径。

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
- 即便如此，外部源仍可能因为限流、网络路径或服务端波动返回 `429` / `5xx` / 超时，这不一定是本地代码问题。

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
│   ├── search.js
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
