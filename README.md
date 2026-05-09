# lit-search

学术文献检索 CLI - 同时搜索多个学术文献数据库

![npm version](https://img.shields.io/npm/v/lit-search)
![Node.js version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## 特性

- **多数据源**：同时检索 5 大学术文献数据库
- **去重合并**：自动去除重复文献
- **BibTeX 格式**：输出标准 BibTeX 字段
- **跨平台**：支持 Windows、macOS、Linux
- **简单易用**：命令行操作，无需图形界面

## 支持的数据源

| 数据源 | 覆盖范围 | 备注 |
|--------|----------|------|
| [OpenAlex](https://openalex.org/) | 全球学术文献 | 主要数据源，稳定性好 |
| [arXiv](https://arxiv.org/) | 预印本论文 | 涵盖物理、数学、计算机科学等领域 |
| [CrossRef](https://www.crossref.org/) | 学术期刊文章 | DOI 收录全面 |
| [CORE](https://core.ac.uk/) | 开放获取论文 | 专注开放获取资源 |
| [Semantic Scholar](https://www.semanticscholar.org/) | 学术论文 | AI 驱动的学术搜索引擎 |

## 各数据源字段支持对比

| 字段 | OpenAlex | arXiv | CrossRef | CORE | Semantic Scholar |
|------|:--------:|:-----:|:--------:|:----:|:----------------:|
| **标题 (title)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **作者 (author)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **年份 (year)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **期刊 (journal)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **DOI** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **摘要 (abstract)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **引用数 (citationCount)** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **PDF 链接 (pdfUrl)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **TLDR/简短摘要** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **关键词 (keywords)** | ❌ | ❌ | ❌ | ❌ | ❌ |

> **注意**：
> - 所有数据源均支持搜索，但返回的字段有所不同
> - 引用数 (citationCount) 在各数据源中的含义可能不同（有些是总引用数，有些是该来源的引用数）
> - PDF 链接可能需要权限或付费才能访问

## 安装

### 方式一：npm 全局安装（推荐）

```bash
npm install -g lit-search
```

安装后即可全局使用：

```bash
lit-search "machine learning" -l 10 -s 2022
```

### 方式二：本地安装

```bash
npm install
```

然后通过 npx 运行：

```bash
npx lit-search "machine learning" -l 10 -s 2022
```

### 方式三：直接运行

```bash
node bin/lit-search.js "machine learning" -l 10
```

## API Key 配置

部分数据源在未配置 Key 时会有更严格的速率限制。推荐先运行：

```bash
lit-search init
```

`lit-search init` 会交互式提示你输入：

- `Semantic Scholar API Key`
- `OpenAlex API Key`
- `CrossRef 联系邮箱`
- `CORE API Key`

配置会保存在本机用户目录下的 `lit-search` 配置文件中，后续 CLI 和 MCP 都会自动读取。

### 环境变量

如果你在 MCP、CI、远程服务器这类无交互环境里运行，更适合用环境变量。支持的变量如下：

```bash
LIT_SEARCH_S2_API_KEY
LIT_SEARCH_OPENALEX_API_KEY
LIT_SEARCH_CROSSREF_MAILTO
LIT_SEARCH_CORE_API_KEY
```

环境变量会覆盖 `lit-search init` 保存的本机配置。

示例：

```bash
# Linux/macOS
export LIT_SEARCH_S2_API_KEY="your-semantic-scholar-api-key"
export LIT_SEARCH_OPENALEX_API_KEY="your-openalex-api-key"
export LIT_SEARCH_CROSSREF_MAILTO="your-email@example.com"
export LIT_SEARCH_CORE_API_KEY="your-core-api-key"

lit-search "machine learning" -l 5
```

```powershell
# Windows PowerShell
$env:LIT_SEARCH_S2_API_KEY="your-semantic-scholar-api-key"
$env:LIT_SEARCH_OPENALEX_API_KEY="your-openalex-api-key"
$env:LIT_SEARCH_CROSSREF_MAILTO="your-email@example.com"
$env:LIT_SEARCH_CORE_API_KEY="your-core-api-key"

lit-search "machine learning" -l 5
```

## MCP 服务

本项目内置了一个基于 stdio 的 MCP 服务入口：

```bash
lit-search-mcp
```

或直接运行：

```bash
node bin/lit-search-mcp.js
```

当前 MCP 服务提供 1 个工具：

- `search_literature`

工具参数：

- `query`
- `limit`
- `yearStart`
- `yearEnd`
- `format`
- `queryExpansion`
- `searchScope`

### Trae 配置示例

Trae 支持通过 MCP 设置界面手动配置，也支持项目级配置文件 `.trae/mcp.json`。如果你使用项目级配置，通常需要先在 Trae 中开启 `Settings > Beta > Enable Project MCP`，然后在项目根目录创建：

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

说明：

- `command`：启动 MCP 服务的命令
- `args`：MCP 服务脚本路径，建议使用绝对路径
- `env`：为 Trae 内启动的 MCP 服务显式注入 API Key，更适合无交互环境

如果你的 `node` 不在系统 `PATH` 中，可以改成 Node 的绝对路径，例如：

```json
{
  "mcpServers": {
    "lit-search": {
      "command": "C:\\Users\\<YourUser>\\AppData\\Local\\nvm\\v22.17.0\\node.exe",
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

如果你更习惯用 Trae 的全局 MCP 配置，也可以直接编辑配置文件：

- Windows：`%APPDATA%\\Trae\\User\\settings\\mcp.json`
- macOS：`~/Library/Application Support/Trae/User/settings/mcp.json`

配置完成后，在 Trae 中重载 MCP 配置或重启 Trae，即可看到 `search_literature` 工具。

### MCP 工具调用示例

`search_literature` 示例参数：

```json
{
  "query": "machine learning, recommendation",
  "limit": 5,
  "yearStart": 2021,
  "format": "bib",
  "queryExpansion": "pairwise",
  "searchScope": "title-abstract"
}
```

## 查询展开策略

多关键词输入时，程序可以按不同策略生成实际检索词。可通过 `--expand` 指定：

- `none`：默认策略。只检索输入的原始关键词，不自动拼组合。
- `pairwise`：生成所有两两组合，再加每个单关键词。
- `full`：生成所有长度大于等于 2 的组合，再加每个单关键词。

示例，输入：

```text
AI, coding, agent
```

各策略效果：

- `--expand none` -> `AI`, `coding`, `agent`
- `--expand pairwise` -> `AI coding`, `AI agent`, `coding agent`, `AI`, `coding`, `agent`
- `--expand full` -> `AI coding agent`, `AI coding`, `AI agent`, `coding agent`, `AI`, `coding`, `agent`

## 检索范围

可通过 `--search-scope` 控制每个文献源的匹配范围：

- `title-only`：只保留标题命中的结果
- `title-abstract`：只保留标题或摘要命中的结果
- `default-engine-search`：使用各文献源的默认搜索策略

说明：

- `arXiv` 会显式使用字段查询：`ti:` / `abs:`
- `CrossRef` 的 `title-only` 会使用 `query.title`
- `OpenAlex` 会显式使用字段查询：`title.search` / `title_and_abstract.search`
- `Semantic Scholar` 当前没有公开的 `title-only` 独立参数；`title-only` 通过默认检索后本地过滤实现，`title-abstract` 与其默认搜索行为基本一致
- `CORE` 当前未接入公开字段级搜索参数，`title-only` / `title-abstract` 通过默认检索后本地过滤实现

各文献源支持情况：

| 文献源 | title-only | title-abstract | default-engine-search |
| --- | --- | --- | --- |
| Semantic Scholar | 默认检索后本地过滤 | 基本等同默认搜索 | 官方默认搜索 |
| OpenAlex | `title.search` | `title_and_abstract.search` | `search` |
| arXiv | `ti:` | `ti:` + `abs:` | 官方默认搜索 |
| CrossRef | `query.title` | `query.bibliographic` + 本地过滤 | `query.bibliographic` |
| CORE | 默认检索后本地过滤 | 默认检索后本地过滤 | 官方默认搜索 |

## 使用方法

### 基本用法

```bash
# 单关键词搜索
lit-search "machine learning"

# 多关键词搜索（逗号分隔）
lit-search "AI, deep learning"

# 限制每个关键词、每个数据源的检索数量
lit-search "machine learning" -l 10

# 限制年份范围
lit-search "machine learning" -s 2022        # 2022年至今
lit-search "machine learning" -u 2020       # 2020年以前
lit-search "machine learning" -s 2020 -u 2024 # 2020-2024年
```

### 完整选项

```
lit-search [关键词] [选项]

参数:
  关键词                  搜索词（多个关键词用逗号分隔）

选项:
  -l, --limit <n>         每个关键词、每个数据源的检索上限（默认: 3）
  -s, --since <year>     起始年份（包含）
  -u, --until <year>     结束年份（包含）
  --format <mode>        输出格式：md|json|bib（默认: md）
  --expand <mode>        查询展开策略：none|pairwise|full（默认: none）
  --search-scope <mode>  检索范围：title-only|title-abstract|default-engine-search
  -h, --help              显示帮助
  -v, --version           显示版本
```

### 示例

```bash
# 交互式配置 API Key
lit-search init

# 搜索 AI 领域的最新论文
lit-search "AI, machine learning" -l 10 -s 2023

# 仅按标题检索
lit-search "machine learning" --search-scope title-only

# 按标题或摘要检索
lit-search "machine learning" --search-scope title-abstract

# 搜索指定年份范围的文献
lit-search "deep learning" -s 2020 -u 2024

# 导出为 JSON
lit-search "neural network" --format json

# 导出为 BibTeX
lit-search "neural network" --format bib

# 查看帮助
lit-search --help
```

### 多检索条件组合示例

```bash
# 多关键词 + 起始年份
lit-search "AI, coding, agent" -l 5 -s 2023

# 多关键词 + 两两组合展开
lit-search "AI, coding, agent" -l 5 -s 2023 --expand pairwise

# 多关键词 + 不自动组合
lit-search "AI, coding, agent" -l 5 -s 2023 --expand none

# 多关键词 + 完整年份区间
lit-search "retrieval augmented generation, llm" -l 8 -s 2021 -u 2024

# 多关键词 + 年份区间 + 导出 JSON
lit-search "graph neural network, recommendation" -l 10 -s 2020 -u 2024 --format json

# 单关键词 + 高检索上限，适合做综述初筛
lit-search "diffusion model" -l 20 -s 2021

# 单关键词 + 截止年份，适合查经典文献
lit-search "support vector machine" -l 10 -u 2015
```

## 输出格式

默认输出为 Markdown，适合直接阅读；如需结构化处理，可通过 `--format json` 导出 JSON，或通过 `--format bib` 导出 BibTeX。

### Markdown 输出

Markdown 文件包含：

- 检索摘要
- 各引擎命中统计
- 每篇文献的详细字段列表

字段会尽量补充为：

- 标题
- 作者
- 年份
- 期刊 / 会议 / 来源
- 卷号、期号、页码
- DOI
- 原文链接 / PDF 链接
- 摘要
- 关键词 / 学科 / 主题
- 引用次数

### JSON 输出

生成的 JSON 文件包含两部分：

```json
{
  "metadata": {
    "query": "machine learning",
    "keywords": ["machine learning"],
    "totalRetrieved": 50,
    "afterDedup": 45,
    "afterFilter": 45,
    "finalCount": 45,
    "yearRange": { "start": 2022, "end": null },
    "engines": ["Semantic Scholar", "OpenAlex", "arXiv", "CrossRef", "CORE"],
    "engineStats": [
      {
        "engine": "OpenAlex",
        "status": "success",
        "queryResults": [{ "query": "machine learning", "status": "success", "count": 10 }],
        "totalPapers": 10
      }
    ]
  },
  "papers": [
    {
      "citation_key": "Author2024_1",
      "entry_type": "article",
      "title": "论文标题",
      "author": "作者1 and 作者2",
      "year": 2024,
      "journal": "期刊名称",
      "booktitle": null,
      "volume": null,
      "number": null,
      "pages": null,
      "publisher": null,
      "address": null,
      "edition": null,
      "month": null,
      "note": null,
      "doi": "10.xxxx/xxxxx",
      "url": "https://...",
      "abstract": "摘要内容",
      "keywords": null,
      "arxiv_id": null,
      "openalex_id": "https://openalex.org/...",
      "source": "openalex",
      "citation_count": 100,
      "relevance_score": 3,
      "seq_id": 1
    }
  ]
}
```

### BibTeX 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `citation_key` | string | 引用键，格式：`作者年份_序号` |
| `entry_type` | string | 条目类型：`article`（期刊论文）或 `misc`（预印本等） |
| `title` | string | 论文标题 |
| `author` | string | 作者列表，用 `and` 分隔 |
| `year` | number | 出版年份 |
| `journal` | string | 期刊/会议名称 |
| `doi` | string | DOI 标识符 |
| `url` | string | 论文链接 |
| `abstract` | string | 论文摘要 |
| `citation_count` | number | 引用次数 |
| `source` | string | 数据来源 |

> 缺省字段统一返回 `null`

### BibTeX 输出

`--format bib` 会生成标准 `.bib` 文件，每篇文献对应一个 BibTeX 条目。当前默认规则：

- 优先输出 `@article`
- `arXiv` 论文输出为 `@misc`
- 若缺少 `journal` 但存在 `venue`，会补到 `booktitle`

示例：

```bibtex
@article{Smith2024_1,
  title = {Paper Title},
  author = {Alice Smith and Bob Lee},
  year = {2024},
  journal = {Journal Name},
  volume = {12},
  number = {3},
  pages = {101-120},
  doi = {10.1000/example},
  url = {https://doi.org/10.1000/example}
}
```

## 搜索机制说明

### 搜索范围

各学术 API 的搜索会匹配多个字段，而非仅限于标题：

- **标题 (title)**
- **摘要 (abstract)**
- **作者 (authors)**
- **关键词 (keywords)**
- **其他元数据**

因此，即使论文标题不包含搜索词，如果其摘要或其他字段包含该词，也会被检索到。

### 多关键词处理

输入多个关键词（如 `AI, deep learning`）时，是否生成组合查询取决于 `--expand`：

1. `none`：只检索原始关键词
2. `pairwise`：生成所有两两组合，再加单关键词
3. `full`：生成所有长度大于等于 2 的组合，再加单关键词

每个查询都会从各个数据源检索，最后合并去重。

### 去重机制

系统通过以下方式去除重复论文：

1. **DOI 匹配**：相同 DOI 的论文视为重复
2. **标题相似度**：使用 Levenshtein 距离计算标题相似度，超过 85% 视为重复

## 网络问题

如果遇到网络错误：

1. **检查网络连接**：确保能正常访问互联网
2. **配置代理**：如需代理，在命令前设置环境变量：
   ```bash
   # Windows PowerShell
   $env:HTTPS_PROXY="http://127.0.0.1:7890"
   
   # Linux/macOS
   export HTTPS_PROXY=http://127.0.0.1:7890
   ```
3. **等待重试**：网络不稳定时，可稍后重试

## 常见问题

### Q: 为什么有些数据源返回 0 篇？

可能原因：
- 网络连接问题（某些 API 在特定地区需要代理）
- 查询词过于特殊
- 年份范围过窄

### Q: 如何只使用特定数据源？

目前暂不支持禁用特定数据源，可通过修改源码实现。

### Q: 如何导入到文献管理软件？

直接使用 `--format bib` 生成 `.bib` 文件，即可导入 Zotero、EndNote、Mendeley 等软件。

## 项目结构

```
lit-search/
├── bin/
│   ├── lit-search.js     # CLI 入口
│   └── lit-search-mcp.js # MCP 服务入口
├── lib/
│   ├── app-config.js     # 本机配置与环境变量读取
│   ├── logger.js         # 日志接口
│   ├── output.js         # md/json/bib 输出渲染
│   ├── search.js         # 核心搜索逻辑
│   └── apis/
│       ├── index.js      # API 导出
│       ├── openalex.js   # OpenAlex API
│       ├── arxiv.js      # arXiv API
│       ├── crossref.js   # CrossRef API
│       ├── core.js       # CORE API
│       └── semantic-scholar.js  # Semantic Scholar API
├── diagnose.js           # 网络/API 诊断脚本
├── test.js               # 联网 smoke test
├── package.json
└── README.md
```

## License

MIT
