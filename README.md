# lit-search

学术文献检索 CLI - 同时搜索多个学术文献数据库

![npm version](https://img.shields.io/npm/v/lit-search)
![Node.js version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## 特性

- **多数据源**：同时检索 5 大学术文献数据库（Semantic Scholar、OpenAlex、arXiv、CrossRef、CORE）
- **去重合并**：基于 DOI 和标题相似度自动去除重复文献
- **相关性排序**：按标题/摘要关键词匹配度 + 引用数综合排序
- **查询展开**：支持 none / pairwise / full 三种多关键词组合策略
- **检索范围控制**：支持 title-only / title-abstract / default-engine-search 三种匹配范围
- **多格式输出**：Markdown（默认）、JSON、BibTeX，可直接导入 Zotero / EndNote / Mendeley
- **丰富元数据**：标题、作者、年份、期刊、卷号、期号、页码、DOI、摘要、引用数、PDF 链接、关键词、学科领域、语言、作品类型等
- **MCP 服务**：内置 stdio MCP 服务，可直接接入 Trae 等 AI 编程工具
- **跨平台**：支持 Windows、macOS、Linux

## 支持的数据源

| 数据源 | 覆盖范围 | 备注 |
|--------|----------|------|
| [Semantic Scholar](https://www.semanticscholar.org/) | 学术论文 | AI 驱动的学术搜索引擎，支持 TLDR 摘要 |
| [OpenAlex](https://openalex.org/) | 全球学术文献 | 主要数据源，稳定性好，字段最丰富 |
| [arXiv](https://arxiv.org/) | 预印本论文 | 涵盖物理、数学、计算机科学等领域 |
| [CrossRef](https://www.crossref.org/) | 学术期刊文章 | DOI 收录全面，期刊元数据最完整 |
| [CORE](https://core.ac.uk/) | 开放获取论文 | 专注开放获取资源 |

## 各数据源字段支持对比

| 字段 | Semantic Scholar | OpenAlex | arXiv | CrossRef | CORE |
|------|:---:|:---:|:---:|:---:|:---:|
| **标题 (title)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **作者 (authors)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **年份 (year)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **期刊/来源 (journal)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **DOI** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **摘要 (abstract)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **引用数 (citationCount)** | ✅ | ✅ | ❌ | ✅ | ✅ |
| **PDF 链接 (pdfUrl)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **卷号 (volume)** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **期号 (issue)** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **页码 (pages)** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **出版商 (publisher)** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **关键词 (keywords)** | ✅¹ | ✅ | ✅² | ✅³ | ✅⁴ |
| **学科领域 (fieldsOfStudy)** | ✅ | ✅⁵ | ❌ | ❌ | ✅⁴ |
| **语言 (language)** | ❌ | ✅ | ❌ | ✅ | ❌ |
| **作品类型 (workType)** | ✅ | ✅ | ❌ | ✅ | ✅ |
| **TLDR 摘要** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **arXiv ID** | ✅⁶ | ✅⁶ | ✅ | ❌ | ✅⁶ |
| **ISSN** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **ISBN** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **主分类 (primaryCategory)** | ❌ | ❌ | ✅ | ❌ | ❌ |

> **注释**：
> - ¹ Semantic Scholar 的 keywords 来自 fieldsOfStudy
> - ² arXiv 的 keywords 来自论文分类标签 (categories)
> - ³ CrossRef 的 keywords 来自 subjects 字段
> - ⁴ CORE 的 keywords/fieldsOfStudy 来自 fieldOfStudy 字段
> - ⁵ OpenAlex 的 fieldsOfStudy 来自 topics 字段
> - ⁶ 通过 externalIds / identifiers 返回

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

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | ✅ | - | 搜索词，多个关键词用逗号分隔 |
| `limit` | number | ❌ | 3 | 每个关键词、每个数据源的检索上限 |
| `yearStart` | number | ❌ | - | 起始年份（包含） |
| `yearEnd` | number | ❌ | - | 结束年份（包含） |
| `format` | string | ❌ | md | 输出格式：md / json / bib |
| `queryExpansion` | string | ❌ | none | 查询展开策略：none / pairwise / full |
| `searchScope` | string | ❌ | default-engine-search | 检索范围：title-only / title-abstract / default-engine-search |

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
  -s, --since <year>      起始年份（包含）
  -u, --until <year>      结束年份（包含）
  --format <mode>         输出格式：md|json|bib（默认: md）
  --expand <mode>         查询展开策略：none|pairwise|full（默认: none）
  --search-scope <mode>   检索范围：title-only|title-abstract|default-engine-search
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

# 导出为 BibTeX（可直接导入 Zotero / EndNote / Mendeley）
lit-search "neural network" --format bib

# 两两组合展开
lit-search "AI, coding, agent" -l 5 -s 2023 --expand pairwise

# 全组合展开
lit-search "retrieval, generation, augmentation" -l 8 -s 2021 --expand full

# 查看帮助
lit-search --help
```

## 输出格式

默认输出为 Markdown，适合直接阅读；如需结构化处理，可通过 `--format json` 导出 JSON，或通过 `--format bib` 导出 BibTeX。

### Markdown 输出

Markdown 文件包含：

- 检索摘要（查询词、展开策略、年份范围等）
- 各引擎命中统计表
- 每篇文献的详细字段列表

每篇文献包含的字段：

| 字段 | 说明 |
|------|------|
| Authors | 作者列表 |
| Year | 出版年份 |
| Source | 数据来源 |
| Journal/Venue | 期刊/会议名称 |
| Volume/Issue/Pages | 卷号、期号、页码 |
| DOI | DOI 标识符 |
| URL | 论文链接 |
| PDF | PDF 链接 |
| Citation Count | 引用次数 |
| Type | 作品类型 |
| Language | 语言 |
| Keywords | 关键词 |
| Fields of Study | 学科领域 |
| Primary Category | 主分类（arXiv） |
| Abstract | 摘要 |

### JSON 输出

生成的 JSON 文件包含 `metadata` 和 `papers` 两部分：

```json
{
  "metadata": {
    "query": "machine learning",
    "keywords": ["machine learning"],
    "queryExpansion": "none",
    "searchScope": "default-engine-search",
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
      "authors": ["作者1", "作者2"],
      "year": 2024,
      "journal": "期刊名称",
      "venue": "会议名称",
      "booktitle": null,
      "volume": "12",
      "number": "3",
      "issue": "3",
      "pages": "101-120",
      "first_page": "101",
      "last_page": "120",
      "publisher": "出版商",
      "doi": "10.xxxx/xxxxx",
      "url": "https://...",
      "pdf_url": "https://...pdf",
      "abstract": "摘要内容",
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
  ]
}
```

### BibTeX 输出

`--format bib` 会生成标准 `.bib` 文件，每篇文献对应一个 BibTeX 条目。

条目类型推断规则：

- 有 `journal` 字段 → `@article`
- 有 `venue` 但无 `journal` → `@inproceedings`（venue 写入 `booktitle`）
- arXiv 论文 → `@misc`（附带 `eprint` 和 `archiveprefix` 字段）
- 其他 → `@misc`

BibTeX 条目包含的字段：

| 字段 | 说明 |
|------|------|
| `title` | 论文标题 |
| `author` | 作者列表，用 `and` 分隔 |
| `year` | 出版年份 |
| `journal` | 期刊名称 |
| `booktitle` | 会议名称（仅会议论文） |
| `volume` | 卷号 |
| `number` | 期号 |
| `pages` | 页码范围 |
| `publisher` | 出版商 |
| `doi` | DOI 标识符 |
| `url` | 论文链接 |
| `abstract` | 摘要 |
| `keywords` | 关键词 |
| `language` | 语言 |
| `note` | 备注 |
| `source` | 数据来源 |
| `citationcount` | 引用次数 |
| `pdfurl` | PDF 链接（如有） |
| `eprint` + `archiveprefix` | arXiv ID（仅 arXiv 论文） |
| `primaryclass` | 主分类（仅 arXiv 论文） |
| `openalexid` | OpenAlex ID（如有） |
| `semanticscholarid` | Semantic Scholar ID（如有） |
| `crossrefid` | CrossRef ID（如有） |
| `coreid` | CORE ID（如有） |
| `issn` | ISSN（如有） |
| `isbn` | ISBN（如有） |

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
  url = {https://doi.org/10.1000/example},
  abstract = {Paper abstract...},
  keywords = {machine learning, deep learning},
  language = {en},
  source = {openalex},
  citationcount = {42}
}
```

## 搜索机制说明

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

### 相关性排序

检索结果按以下规则排序：

1. **相关性评分**：标题中出现关键词 +3 分，摘要中出现 +1 分，总分越高排越前
2. **引用数**：相关性评分相同时，引用数高的排前面

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
- 触发了速率限制（配置 API Key 可提高限额）

### Q: 如何导入到文献管理软件？

直接使用 `--format bib` 生成 `.bib` 文件，即可导入 Zotero、EndNote、Mendeley 等软件。

### Q: 如何排查问题？

运行诊断工具：

```bash
npm run diagnose
```

诊断工具会检查 API Key 配置状态、各引擎连通性、字段返回情况、搜索范围功能等。

## 测试与诊断

```bash
# 基础帮助输出检查
npm test

# 完整验收测试（覆盖所有配置项的联网测试）
npm run test:acceptance

# 网络/API 诊断
npm run diagnose
```

## 项目结构

```
lit-search/
├── bin/
│   ├── lit-search.js       # CLI 入口
│   └── lit-search-mcp.js   # MCP 服务入口
├── lib/
│   ├── app-config.js       # 本机配置与环境变量读取
│   ├── key-config.js       # API Key 文件加载与别名映射
│   ├── logger.js           # 日志接口
│   ├── output.js           # md/json/bib 输出渲染
│   ├── search.js           # 核心搜索逻辑（多源检索、去重、排序）
│   └── apis/
│       ├── index.js        # API 导出
│       ├── openalex.js     # OpenAlex API
│       ├── arxiv.js        # arXiv API
│       ├── crossref.js     # CrossRef API
│       ├── core.js         # CORE API
│       ├── semantic-scholar.js  # Semantic Scholar API
│       └── request-utils.js     # 请求超时与中断工具
├── diagnose.js             # 网络/API 诊断脚本
├── test.js                 # 联网验收测试
├── package.json
└── README.md
```

## License

MIT
