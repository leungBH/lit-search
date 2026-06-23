# lit-search

[![npm](https://img.shields.io/npm/v/lit-search?label=npm)](https://www.npmjs.com/package/lit-search)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

`lit-search` 是一个学术文献检索 CLI / MCP 服务，可同时检索 Semantic Scholar、OpenAlex、arXiv、CrossRef、CORE、Europe PMC、DBLP 和 DOAJ，并将结果整理为可复现、可继续处理、可用于 LaTeX 写作的文献池。

默认检索只生成三个文件：

```text
lit_search_YYYYMMDD_HHMMSS/
├── search_meta.json
├── literature_pool.json
└── references.bib
```

本项目不再提供 PDF 下载能力。PDF 原文获取建议交给专门的下游工程处理。

## 特性

- **多数据源检索**：Semantic Scholar、OpenAlex、arXiv、CrossRef、CORE、Europe PMC、DBLP、DOAJ；PubMed 可选启用。
- **免费权威源优先**：新增源均不需要机构购买或商业授权；PubMed/NCBI Key 和 Unpaywall email 只是免费限速/增强配置。
- **可复现检索记录**：`search_meta.json` 记录时间、查询条件、关键词、年份范围、检索范围、数据源和统计信息。
- **完整机器结果**：`literature_pool.json` 尽可能保留标题、作者、摘要、关键词、出版物、卷期页、DOI、URL、引用数、标识符、PDF 候选链接等结构化字段。
- **正式引用优先**：可将 arXiv 预印本反查为正式出版版本，引用信息优先使用正式 DOI、期刊/会议、卷期页。
- **BibTeX 导出**：`references.bib` 使用尽量主流、LaTeX 友好的字段，便于论文写作和导入 Zotero / EndNote / Mendeley；开启正式出版解析后，BibTeX 优先来自正式出版元数据。
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
- NCBI API Key，可选，用于 PubMed 更高限速
- Unpaywall email，可选，用于 DOI 开放获取元数据增强

没有 Key 时也可以使用部分公开接口，但限流会更明显。

## 数据源

默认检索源：

- Semantic Scholar
- OpenAlex
- arXiv
- CrossRef
- CORE
- Europe PMC
- DBLP
- DOAJ

可选检索源：

- PubMed / NCBI E-utilities：默认关闭，可在配置中启用；免费 NCBI API Key 只用于提高限速。

单次运行启用 PubMed：

```bash
lit-search "cancer immunotherapy" --with-pubmed
```

增强源：

- Unpaywall：通过 DOI 补充开放获取状态、许可证和 `pdf_candidates`，配置 email 后启用。
- OpenCitations：通过 DOI 补充引用关系，默认关闭，适合后续引用扩展场景。

单次运行启用 OpenCitations：

```bash
lit-search "knowledge distillation" --with-opencitations
```

暂不集成：

- DataCite、OpenAIRE：覆盖大量数据集、软件、项目和机构产物，可能降低论文池纯度。
- IEEE、Elsevier、Web of Science、Dimensions、Lens、Springer：更适合作为机构授权或付费增强源，不作为默认开源能力。

## CLI 用法

```bash
lit-search "machine learning"
lit-search search "machine learning"
lit-search "AI, coding, agent" -l 5 -s 2023
lit-search "AI, coding, agent" --expand pairwise
lit-search "computer vision" --search-scope title-only
lit-search "attention is all you need" --resolve-preprint --prefer-published
lit-search "cancer immunotherapy" --with-pubmed
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
--resolve-preprint       尽可能将 arXiv 预印本解析为正式出版版本
--prefer-published       引用字段和 BibTeX 优先使用正式出版元数据
--with-pubmed            本次检索启用 PubMed/NCBI
--with-opencitations     本次运行启用 OpenCitations DOI 引用关系增强
--enrich                 merge 后立即补全缺失元数据
--fields <list>          enrich 时指定字段，例如 abstract,keywords,doi,url,venue
--only-missing [fields]  enrich 时只补缺失字段，例如 abstract
--checkpoint-interval <n>
                         enrich 时每处理 n 篇写回一次，默认 5，0 表示关闭
--concurrency <n>        enrich 的论文级并发数，默认 1
--overwrite              enrich 时也刷新已有元数据
```

`limit` 是“每个关键词、每个数据源”的上限，不是最终结果数量上限。

## 正式出版元数据解析

有些论文先以 arXiv 预印本出现，之后又正式发表在期刊或会议中。写论文时通常应该引用正式出版版本，但 PDF 候选链接仍然可以保留 arXiv。

开启方式：

```bash
lit-search "attention is all you need" --resolve-preprint --prefer-published
lit-search merge ./batch1 ./batch2 -o ./merged --prefer-published
```

当前策略：

- 保持 `literature_pool.json` 现有顶层字段稳定。
- 额外写入 `identity`、`citation_metadata`、`preprint`、`metadata_sources`、`publication_status`、`citation_metadata_preference`。
- 对 arXiv 论文优先通过 DOI / OpenAlex / 标题作者年份匹配查找正式出版记录。
- 开启 `--prefer-published` 后，顶层 `doi`、`journal`、`venue`、`pages`、`publisher` 等引用字段会尽量更新为正式出版版本。
- `pdf_candidates` 不作为引用来源，只保留候选链接元数据。
- `references.bib` 优先从 `citation_metadata` 生成；如果仍有 arXiv ID，会保留 `eprint`、`archivePrefix`、`primaryClass`。

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
- `oa_status`
- `is_oa`
- `license`
- `citation_relations`
- `identity`
- `citation_metadata`
- `preprint`
- `metadata_sources`
- `publication_status`
- `citation_metadata_preference`
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

合并时优先正式出版元数据：

```bash
lit-search merge ./batch1 ./batch2 -o ./merged --prefer-published
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
  "resolvePreprint": true,
  "preferPublished": true,
  "withPubMed": false,
  "withOpenCitations": false,
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

## 如何发版

本项目用 GitHub Actions + npm Automation Token 自动化发版。Token 只存在于 GitHub 仓库的 `NPM_TOKEN` secret 里，**永远不要把 token 写进代码或 commit**。

### 一次性配置（仓库维护者）

1. 去 https://www.npmjs.com/settings/&lt;your-username&gt;/tokens 生成一个 **Automation** 类型的 token：
   - Packages 范围选 **Only select packages and scopes** → 勾上 `lit-search`
   - Permissions 保持默认 **Read and publish**
2. 去 https://github.com/leungBH/lit-search/settings/secrets/actions 添加 secret：
   - Name：`NPM_TOKEN`（**必须这个大小写**）
   - Value：粘贴上一步的 token

### 日常发版流程

```bash
# 1) 改代码、提 PR、走 review
git checkout -b feat/some-improvement
git commit -m "feat: add some improvement"
gh pr create --label "feat"

# 2) 合并后，main 上的 CI 会自动跑测试
git checkout main && git pull

# 3) 升级版本号（自动改 package.json + package-lock.json + commit）
npm version patch   # 1.4.4 → 1.4.5
# 或 npm version minor
# 或 npm version major

# 4) 推 commit 和 tag
git push origin main --follow-tags
```

`git push --follow-tags` 会把新 tag `v1.4.5` 推到 GitHub，触发 `release.yml`：

1. 跑 `npm test`（测试挂了不发布）
2. 校验 tag 版本号 = `package.json` 版本号
3. `npm publish --access public` 发到 npm
4. release.yml 在 npm publish 成功后用 `softprops/action-gh-release` 创建 GitHub Release（`generate_release_notes: true` 由 GitHub 自动聚合 PR / commit 生成 changelog）

### PR Label 约定

为了让 release notes 自动按类别分组，PR 至少打一个 label：

| Label | 在 changelog 里出现在 | 触发版本号 bump |
|---|---|---|
| `breaking` 或 `major` | 🚨 Breaking changes | major |
| `feat`、`enhancement` | 🚀 Features | minor |
| `fix`、`bug` | 🐛 Bug fixes | patch |
| `chore`、`ci`、`refactor`、`perf`、`test` | 📦 Maintenance | patch |
| `docs` | 📝 Documentation | — |

如果 PR 没打 label，release-drafter 默认归为 patch。手动 `npm version` 时不受 label 影响。

### 依赖更新

`dependabot` 每周一 09:00（北京时间）自动检查 npm 依赖更新，PR 会带 `dependencies` 和 `npm` label，按 `production-dependencies` / `development-dependencies` 分组。

CLI 表面相关的包（`commander`、`chalk`）会忽略 major 升级。`conf` 和 `inquirer` 当前在 ignore 列表里（`conf 14+` 要求 Node 20，超越本项目 `engines: >=18`；`inquirer 14+` 有破坏性 prompt 变化），需要升级时手动提 PR。

## License

MIT
