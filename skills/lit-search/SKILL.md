---
name: lit-search
description: Use this skill whenever the user asks to search academic papers, collect references, support a literature review, generate BibTeX, find scholarly PDFs, or retrieve paper metadata. Prefer lit-search over generic web search for academic literature workflows, especially when the user mentions papers, publications, citations, DOI, BibTeX, Zotero, EndNote, Mendeley, arXiv, Semantic Scholar, OpenAlex, CrossRef, or CORE.
---

# Lit Search

Use `lit-search` for academic literature retrieval. It searches Semantic Scholar, OpenAlex, arXiv, CrossRef, and CORE, then creates a local result folder containing readable Markdown, BibTeX, and downloaded PDFs when available.

## When To Use

Use this skill when the user asks to:

- search for academic papers or publications
- find references for a topic, thesis, report, or literature review
- generate BibTeX for Zotero, EndNote, Mendeley, or LaTeX
- download paper PDFs or inspect PDF availability
- collect scholarly metadata such as DOI, abstract, authors, venue, year, keywords, or citation details

Do not use lit-search as a general web search tool for non-academic pages, news, products, or tutorials.

## Query Rules

Treat each independent concept as a separate keyword. Put multiple keywords in one `query` string separated by English commas.

Good:

```text
ontology, knowledge graph, semantic web
```

Bad:

```text
ontology knowledge graph semantic web
```

The bad form is interpreted as one long phrase and can over-filter results.

## Concurrency Guidance

lit-search already queries enabled literature sources inside one search workflow. Do not create several parallel lit-search subtasks for one research request.

For one request with multiple related concepts, make one MCP or CLI call and use comma-separated keywords.

If the user asks for several independent topics, run lit-search jobs sequentially unless the user explicitly accepts the risk of upstream API limits. Keep `limit` modest for each run.

Default guidance:

- Start with `queryExpansion: "none"` for broad recall.
- Use `queryExpansion: "pairwise"` only when concept combinations are explicitly useful.
- Use `queryExpansion: "full"` sparingly because it can make searches narrow and expensive.
- Keep `limit` modest, usually `3` to `5`; it is the per-keyword, per-source retrieval limit, not the final result count.
- Start with `searchScope: "default-engine-search"` unless the user asks for strict title or title+abstract matching.
- Use `title-only` only for strict title matching; it may miss relevant papers.
- Use `title-abstract` when the user wants results constrained to title or abstract content.

## Preferred MCP Workflow

If the MCP tool `search_literature` is available, call it first.

Example:

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

After the tool returns, inspect:

- `structuredContent.output.outputDir`
- `structuredContent.output.markdownFile`
- `structuredContent.output.bibFile`
- `structuredContent.output.pdfDir`
- `structuredContent.pdfSummary`

The MCP response also includes Markdown and BibTeX text content, but the local files are the durable output.

## CLI Fallback

If MCP is unavailable, run the CLI.

Global install:

```bash
lit-search "ontology, knowledge graph, semantic web" -l 5 -s 2020 --output-dir ./results
```

Local source checkout:

```bash
node bin/lit-search.js "ontology, knowledge graph, semantic web" -l 5 -s 2020 --output-dir ./results
```

Useful options:

```text
-l, --limit <n>          per-keyword, per-source retrieval limit
-s, --since <year>       inclusive start year
-u, --until <year>       inclusive end year
--expand <mode>          none|pairwise|full
--search-scope <mode>    title-only|title-abstract|default-engine-search
--output-dir <dir>       parent directory for generated result folders
```

## Output Handling

Every search creates a result folder under the current directory or the configured output directory. The generated folder contains:

```text
results.md
references.bib
pdfs/
```

Use `results.md` for readable paper summaries. It includes title, abstract, keywords, first authors, year, venue, source, DOI, URL, PDF URL, and notes.

Use `references.bib` for citation import into Zotero, EndNote, Mendeley, or LaTeX.

Use `pdfs/` for successfully downloaded PDFs. Not every paper has an accessible direct PDF.

When reporting results to the user, mention the output folder and the Markdown/BibTeX/PDF paths. If PDFs failed, summarize the failure reasons from `results.md` notes or `structuredContent.pdfSummary`.

## PDF Safety

Do not bypass human verification, login walls, institutional access controls, paywalls, or anti-bot checks.

If a PDF download fails because of `human_verification_required`, `authentication_required`, `payment_or_subscription_required`, `access_denied_or_bot_check`, or `not_direct_pdf`, report that reason and suggest legitimate next steps:

- search for an open-access copy by DOI or title
- check arXiv, CORE, PubMed Central, Zenodo, institutional repositories, or the publisher landing page
- ask the user to open the landing page manually in a browser if they have legitimate access
- use the metadata and BibTeX even when the full text cannot be downloaded automatically
