# lit-search

[![npm](https://img.shields.io/npm/v/lit-search?label=npm)](https://www.npmjs.com/package/lit-search)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

`lit-search` 是一个学术文献检索 CLI / MCP 服务，可同时检索 Semantic Scholar、OpenAlex、arXiv、CrossRef 和 CORE，并将结果整理为可复现、可继续处理、可用于 LaTeX 写作的文献池。

默认检索只生成三个文件：

```text
lit_search_YYYYMMDD_HHMMSS/
├── search_meta.json
├── literature_pool.json
└── references.bib
```

本项目不再提供 PDF 下载能力。PDF 原文获取建议交给专门的下游工程处理。

## 特性

- **多数据源检索**：Semantic Scholar、OpenAlex、arXiv、CrossRef、CORE。
- **可复现检索记录**：`search_meta.json` 记录时间、查询条件、关键词、年份范围、检索范围、数据源和统计信息。
- **完整机器结果**：`literature_pool.json` 尽可能保留标题、作者、摘要、关键词、出版物、卷期页、DOI、URL、引用数、标识符、PDF 候选链接等结构化字段。
- **BibTeX 导出**：`references.bib` 使用尽量主流、LaTeX 友好的字段，便于论文写作和导入 Zotero / EndNote / Mendeley。
- **去重合并**：按 DOI 和标题相似度合并重复文献。
- **查询展开**：支持 `none`、`pairwise`、`full` 三种多关键词组合策略。
- **检索范围控制**：支持 `title-only`、`title-abstract`、`default-engine-search`。
- **文献池管理**：支持 `merge`、`resolve`、`enrich`。
- **MCP 服务**：可接入 Trae、Codex 等支持 MCP 的智能体客户端。

## 安装

```bash
npm install -g lit-search
```

本地源码运行：

```bash
npm install
node ./bin/lit-search.js "machine learning" -l 3
```

## 初始化 API Key

```bash
lit-search init
```

可配置：

- Semantic Scholar API Key
- OpenAlex API Key
- CrossRef contact email
- CORE API Key

没有 Key 时也可以使用部分公开接口，但限流会更明显。

## CLI 用法

```bash
lit-search "machine learning"
lit-search search "machine learning"
lit-search "AI, coding, agent" -l 5 -s 2023
lit-search "AI, coding, agent" --expand pairwise
lit-search "computer vision" --search-scope title-only
lit-search "machine learning" --output-dir ./results
```

完整命令：

```text
lit-search [query] [options]
lit-search search [query] [options]
lit-search merge <pool...> -o <output-dir>
lit-search enrich <pool-folder|literature_pool.json>
lit-search resolve <citations.txt> [options]
lit-search init
```

常用参数：

```text
-l, --limit <n>          每个关键词、每个数据源的检索上限，默认 3
-s, --since <year>       起始年份，包含该年
-u, --until <year>       结束年份，包含该年
--expand <mode>          查询展开策略：none|pairwise|full，默认 none
--search-scope <mode>    title-only|title-abstract|default-engine-search
--output-dir <dir>       生成结果文件夹的父目录
--enrich                 merge 后立即补全缺失元数据
--fields <list>          enrich 时指定字段，例如 abstract,keywords,doi,url,venue
--only-missing [fields]  enrich 时只补缺失字段，例如 abstract
--checkpoint-interval <n>
                         enrich 时每处理 n 篇写回一次，默认 5，0 表示关闭
--concurrency <n>        enrich 的论文级并发数，默认 1
--overwrite              enrich 时也刷新已有元数据
```

`limit` 是“每个关键词、每个数据源”的上限，不是最终结果数量上限。

## 多关键词策略

多个关键词用英文逗号分隔：

```bash
lit-search "ontology, knowledge graph, semantic web" -l 5
```

默认 `--expand none`，只检索原始关键词。可选策略：

- `none`：只查原始关键词。
- `pairwise`：生成两两组合，再查原始关键词。
- `full`：生成完整组合、两两组合和原始关键词。

## 输出文件

### `search_meta.json`

用于复现检索，记录：

- 工具名称和生成时间
- 输出目录
- 查询词、展开策略、检索范围
- 关键词列表
- 年份范围
- 启用数据源
- 每个数据源的检索状态和数量
- 原始数量、去重后数量、过滤后数量、最终数量
- 输出文件清单

### `literature_pool.json`

机器可读的完整文献池。每篇文献尽可能包含：

- `title`
- `authors` / `author`
- `year`
- `journal` / `venue` / `booktitle`
- `volume` / `issue` / `pages`
- `doi`
- `url`
- `abstract`
- `keywords`
- `citation_count`
- `source`
- `identifiers`
- `pdf_candidates`
- `metadata_status`
- `metadata_enrichment`

`pdf_candidates[]` 只是检索源提供的候选链接元数据，不会触发下载。

### `references.bib`

用于 LaTeX 和参考文献管理器。BibTeX 字段尽量保持主流兼容：

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
- `eprint`
- `archivePrefix`
- `primaryClass`
- `issn`
- `isbn`

完整机器字段请以 `literature_pool.json` 为准。

## 文献池管理

合并多批结果：

```bash
lit-search merge ./batch1 ./batch2 -o ./merged
```

合并后补全缺失元数据：

```bash
lit-search merge ./batch1 ./batch2 -o ./merged --enrich
```

只补缺失摘要：

```bash
lit-search enrich ./merged --only-missing abstract
```

从参考文献条目反查具体文献：

```bash
lit-search resolve ./citations.txt --output-dir ./resolved
```

## MCP 使用

启动命令：

```bash
node D:/lit-search/bin/lit-search-mcp.js
```

MCP 工具：

```text
search_literature
merge_pools
enrich_metadata
resolve_citations
```

`search_literature` 每次调用都会创建结果文件夹，并返回：

- `structuredContent.output.metaFile`
- `structuredContent.output.poolJsonFile`
- `structuredContent.output.bibFile`
- `structuredContent.papers`
- `content[0]` 中的文件路径摘要
- `content[1]` 中的 BibTeX 文本

智能体调用建议：

```json
{
  "query": "ontology, knowledge graph, semantic web",
  "limit": 5,
  "yearStart": 2020,
  "queryExpansion": "none",
  "searchScope": "default-engine-search",
  "outputDir": "D:/lit-search-results"
}
```

不要把多个概念写成一个长短语，例如不要传：

```text
ontology knowledge graph semantic web
```

应传：

```text
ontology, knowledge graph, semantic web
```

## 在 Codex 中注册 MCP

示例配置：

```toml
[mcp_servers.lit-search]
command = "node"
args = ["D:/lit-search/bin/lit-search-mcp.js"]
cwd = "D:/lit-search"
```

Windows 如果需要固定 Node 路径：

```toml
[mcp_servers.lit-search]
command = "C:/Program Files/nodejs/node.exe"
args = ["D:/lit-search/bin/lit-search-mcp.js"]
cwd = "D:/lit-search"
```

## 开发测试

```bash
npm install
npm test
LIT_SEARCH_SKIP_NETWORK_TESTS=1 node test.js
```

真实接口验收：

```bash
node ./bin/lit-search.js "machine learning" -l 1 -s 2023 --output-dir ./temp
```

## License

MIT
