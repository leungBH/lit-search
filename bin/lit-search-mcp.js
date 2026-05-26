#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { downloadPoolPdfs, runLitSearchWorkflow } from '../lib/workflow.js';
import { readLiteraturePool, resolvePoolPath } from '../lib/output-files.js';
import { enrichMetadata, filterPapersForPdfRetry, mergePools, resolveCitationsFile, summarizePool } from '../lib/pool-ops.js';
import { createAppConfig, getResolvedApiKeys } from '../lib/app-config.js';
import { silentLogger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
const config = createAppConfig();
const debugLogFile = process.env.LIT_SEARCH_MCP_DEBUG_FILE ||
  (process.env.LIT_SEARCH_MCP_DEBUG === '1' ? join(packageRoot, 'temp', 'mcp-debug.log') : null);

logDebug(`startup sdk node=${process.version} cwd=${process.cwd()} argv=${JSON.stringify(process.argv)}`);

const server = new McpServer({
  name: 'lit-search-mcp',
  version: packageJson.version
});

server.registerTool(
  'search_literature',
  {
    title: 'Search Literature',
    description: [
      'Search academic literature across Semantic Scholar, OpenAlex, arXiv, CrossRef, and CORE.',
      'This tool does not only return metadata: every call creates a local result folder.',
      'By default it only searches and writes the literature pool; it does not download PDFs unless downloadPdf=true.',
      'The folder always contains literature_pool.md, literature_pool.json, references.bib, pdf_status.md, and a pdfs/ subfolder.',
      'Read structuredContent.output for outputDir, literaturePoolFile, bibFile, pdfStatusFile, poolJsonFile, and pdfDir.',
      'Read structuredContent.pdfSummary for PDF status and download diagnostics.',
      'lit-search already searches enabled literature sources inside one tool call; do not split one research request into parallel lit-search subtasks.',
      'Agent guidance: treat each independent concept as a separate keyword.',
      'Use comma-separated query text such as "ontology, knowledge graph, semantic web".',
      'Do not send a long space-separated bag of concepts such as "ontology knowledge graph semantic web"; that is interpreted as one phrase and may over-filter results.',
      'For several independent research topics, prefer sequential lit-search calls with modest limits instead of parallel calls to avoid upstream API limits.',
      'Use outputDir to choose the parent directory where the generated result folder will be created.',
      'Use queryExpansion="none" for broad recall, "pairwise" only when combinations are needed, and keep limit modest because it is per keyword per source.'
    ].join(' '),
    inputSchema: {
      query: z.string().min(1).describe('Search query. For multiple concepts, prefer comma-separated terms, e.g. "ontology, knowledge graph, semantic web". Avoid long space-separated bags of concepts.'),
      limit: z.number().optional().describe('Per-keyword, per-source retrieval limit. Default: 3.'),
      yearStart: z.number().optional().describe('Inclusive start year.'),
      yearEnd: z.number().optional().describe('Inclusive end year.'),
      queryExpansion: z.enum(['none', 'pairwise', 'full']).optional().describe('Query expansion strategy. Default none. Use pairwise/full only after splitting concepts into keywords.'),
      searchScope: z.enum(['title-only', 'title-abstract', 'default-engine-search']).optional().describe('Search scope strategy. Default default-engine-search for recall; title-only is strict.'),
      outputDir: z.string().optional().describe('Parent directory for generated result folders. The tool still creates a timestamped result folder containing literature_pool.md, references.bib, pdf_status.md, and pdfs/.'),
      downloadPdf: z.boolean().optional().describe('Whether to download PDFs immediately. Default false; prefer false for agent workflows, then call CLI pdf workflow explicitly if needed.')
    }
  },
  async args => {
    logDebug(`tool search_literature args=${JSON.stringify(args)}`);
    const agentGuidance = buildAgentGuidance(args.query);
    const workflow = await runLitSearchWorkflow({
      query: args.query,
      keywords: [],
      excludeTerms: [],
      yearStart: normalizeOptionalNumber(args.yearStart),
      yearEnd: normalizeOptionalNumber(args.yearEnd),
      limit: normalizeOptionalNumber(args.limit) || 3,
      queryExpansion: normalizeEnum(args.queryExpansion, ['none', 'pairwise', 'full'], 'none'),
      searchScope: normalizeEnum(
        args.searchScope,
        ['title-only', 'title-abstract', 'default-engine-search'],
        'default-engine-search'
      ),
      apiKeys: getResolvedApiKeys(config),
      logger: silentLogger,
      outputBaseDir: args.outputDir || process.cwd(),
      downloadPdf: args.downloadPdf === true
    });

    workflow.result.metadata.agentGuidance = agentGuidance;
    logDebug(`tool search_literature done papers=${workflow.result.papers.length}`);

    return {
      content: [
        {
          type: 'text',
          text: buildMcpOutputSummary(workflow)
        },
        {
          type: 'text',
          text: workflow.markdown
        },
        {
          type: 'text',
          text: workflow.bibtex
        }
      ],
      structuredContent: {
        ...workflow.result,
        output: workflow.output,
        pdfSummary: workflow.pdfSummary
      }
    };
  }
);

server.registerTool(
  'download_pdfs',
  {
    title: 'Download PDFs',
    description: [
      'Download PDFs for an existing lit-search literature pool.',
      'Input can be a result folder, literature_pool.json, literature_pool.md, results.md, or pdf_status.md.',
      'This is the MCP equivalent of "lit-search pdf". It updates literature_pool.md, references.bib, pdf_status.md, and literature_pool.json in place.',
      'Use retry="failed" to only retry papers with downloadable PDF candidates that are not already downloaded.',
      'Use retry="missing" only to refresh status for papers without downloadable PDF candidates; these cannot be downloaded automatically.',
      'Do not run multiple PDF download calls in parallel for the same pool.'
    ].join(' '),
    inputSchema: {
      poolPath: z.string().min(1).describe('Path to a lit-search result folder, literature_pool.json, literature_pool.md, results.md, or pdf_status.md.'),
      retry: z.enum(['all', 'failed', 'missing']).optional().describe('Retry mode. Default all; failed skips already-downloaded PDFs.')
    }
  },
  async args => {
    logDebug(`tool download_pdfs args=${JSON.stringify(args)}`);
    const poolFile = resolvePoolPath(args.poolPath);
    const pool = readLiteraturePool(poolFile);
    const outputDir = dirname(poolFile);
    const retryMode = normalizeEnum(args.retry, ['all', 'failed', 'missing'], 'all');
    const targetPapers = filterPapersForPdfRetry(pool.papers || [], retryMode);
    const workflow = await downloadPoolPdfs(pool, outputDir, {
      logger: silentLogger,
      papers: targetPapers
    });

    return {
      content: [
        {
          type: 'text',
          text: [
            'lit-search PDF download completed.',
            '',
            `Result folder: ${workflow.output.outputDir}`,
            `PDF status: ${workflow.output.pdfStatusFile}`,
            `PDFs: ${workflow.output.pdfDir}`,
            '',
            `PDF status: ${workflow.pdfSummary.downloaded}/${workflow.pdfSummary.total} downloaded, ${workflow.pdfSummary.failed} failed, ${workflow.pdfSummary.skipped} skipped.`,
            'Inspect structuredContent.pdfSummary.results for failure codes, reasons, and suggested next actions.'
          ].join('\n')
        }
      ],
      structuredContent: {
        output: workflow.output,
        pdfSummary: workflow.pdfSummary
      }
    };
  }
);

server.registerTool(
  'pool_status',
  {
    title: 'Literature Pool Status',
    description: [
      'Summarize an existing lit-search literature pool.',
      'Input can be a result folder, literature_pool.json, literature_pool.md, results.md, or pdf_status.md.',
      'This is the MCP equivalent of "lit-search status".'
    ].join(' '),
    inputSchema: {
      poolPath: z.string().min(1).describe('Path to a lit-search result folder, literature_pool.json, literature_pool.md, results.md, or pdf_status.md.')
    }
  },
  async args => {
    logDebug(`tool pool_status args=${JSON.stringify(args)}`);
    const poolFile = resolvePoolPath(args.poolPath);
    const pool = readLiteraturePool(poolFile);
    const summary = summarizePool(pool);

    return {
      content: [
        {
          type: 'text',
          text: [
            'lit-search pool status.',
            '',
            `Pool: ${poolFile}`,
            `Papers: ${summary.papers}`,
            `PDF downloaded: ${summary.pdf.downloaded}`,
            `PDF not attempted: ${summary.pdf.notAttempted}`,
            `PDF missing URL: ${summary.pdf.missingUrl}`,
            `PDF failed: ${summary.pdf.failed}`,
            `PDF skipped: ${summary.pdf.skipped}`
          ].join('\n')
        }
      ],
      structuredContent: {
        poolFile,
        summary
      }
    };
  }
);

server.registerTool(
  'merge_pools',
  {
    title: 'Merge Literature Pools',
    description: [
      'Merge multiple lit-search literature pools into one deduplicated pool.',
      'Inputs can be result folders, literature_pool.json, literature_pool.md, results.md, or pdf_status.md.',
      'This is the MCP equivalent of "lit-search merge".',
      'Merging writes literature_pool.md, literature_pool.json, references.bib, pdf_status.md, and pdfs/ into outputDir.'
    ].join(' '),
    inputSchema: {
      inputs: z.array(z.string().min(1)).min(1).describe('Pool paths to merge.'),
      outputDir: z.string().optional().describe('Directory for the merged pool. Default: ./merged_literature.')
    }
  },
  async args => {
    logDebug(`tool merge_pools args=${JSON.stringify(args)}`);
    const outputDir = resolve(args.outputDir || 'merged_literature');
    const result = mergePools(args.inputs, outputDir);

    return {
      content: [
        {
          type: 'text',
          text: [
            `Merged ${args.inputs.length} pool(s).`,
            '',
            `Result folder: ${outputDir}`,
            `Papers: ${result.pool.papers.length}`,
            `Literature pool: ${result.files.literaturePoolFile}`,
            `BibTeX: ${result.files.bibFile}`,
            `PDF status: ${result.files.pdfStatusFile}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ...result.pool,
        output: {
          outputDir,
          literaturePoolFile: result.files.literaturePoolFile,
          markdownFile: result.files.markdownFile,
          bibFile: result.files.bibFile,
          pdfStatusFile: result.files.pdfStatusFile,
          poolJsonFile: result.files.poolJsonFile,
          metaFile: result.files.metaFile,
          pdfDir: join(outputDir, 'pdfs')
        }
      }
    };
  }
);

server.registerTool(
  'enrich_metadata',
  {
    title: 'Enrich Metadata',
    description: [
      'Enrich missing metadata in an existing lit-search literature pool.',
      'Input can be a result folder, literature_pool.json, literature_pool.md, results.md, or pdf_status.md.',
      'This is the MCP equivalent of "lit-search enrich".',
      'It looks up missing fields by arXiv ID, DOI via OpenAlex and Semantic Scholar, source IDs, then title fallback.',
      'Fields include abstract, keywords, journal/venue, DOI, URL, volume/issue/pages, publisher, language, work_type, identifiers, and pdf_candidates.',
      'It rewrites literature_pool.json, literature_pool.md, references.bib, and search_meta.json in place.',
      'By default it does not overwrite existing metadata.',
      'For agent workflows that only need abstracts, call with fields="abstract", onlyMissing=true, concurrency=1, and checkpointInterval=5.',
      'Do not run multiple enrich_metadata calls in parallel for the same pool.'
    ].join(' '),
    inputSchema: {
      poolPath: z.string().min(1).describe('Path to a lit-search result folder or pool file.'),
      fields: z.string().optional().describe('Comma-separated fields to enrich. Default: all supported metadata fields.'),
      onlyMissing: z.boolean().optional().describe('Only fill missing requested fields. Default false, but existing fields are still preserved unless overwrite=true.'),
      checkpointInterval: z.number().optional().describe('Save progress every n processed papers. Default: 5. Use 0 to disable checkpoint writes.'),
      concurrency: z.number().optional().describe('Paper-level enrichment concurrency. Default: 1. Keep 1 unless the user accepts upstream API limit risk.'),
      overwrite: z.boolean().optional().describe('Whether to refresh existing metadata too. Default false.')
    }
  },
  async args => {
    logDebug(`tool enrich_metadata args=${JSON.stringify(args)}`);
    const result = await enrichMetadata(args.poolPath, {
      overwrite: args.overwrite === true,
      onlyMissing: args.onlyMissing === true,
      fields: args.fields,
      checkpointInterval: normalizeOptionalNumber(args.checkpointInterval) ?? 5,
      concurrency: normalizeOptionalNumber(args.concurrency) ?? 1,
      apiKeys: getResolvedApiKeys(config),
      logger: silentLogger
    });

    return {
      content: [
        {
          type: 'text',
          text: [
            'lit-search metadata enrichment completed.',
            '',
            `Result folder: ${result.outputDir}`,
            `Fields: ${result.pool.metadata.metadataEnrichment.fields.join(', ')}`,
            `Only missing: ${result.pool.metadata.metadataEnrichment.onlyMissing}`,
            `Concurrency: ${result.pool.metadata.metadataEnrichment.concurrency}`,
            `Checkpoint interval: ${result.pool.metadata.metadataEnrichment.checkpointInterval || 'disabled'}`,
            `Complete: ${result.stats.complete}`,
            `Attempted: ${result.stats.attempted}`,
            `Enriched papers: ${result.stats.enrichedPapers}`,
            `Enriched fields: ${result.stats.enrichedFields}`,
            `Lookup failed: ${result.stats.lookupFailed}`,
            `Literature pool: ${result.files.literaturePoolFile}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ...result.pool,
        output: {
          outputDir: result.outputDir,
          literaturePoolFile: result.files.literaturePoolFile,
          markdownFile: result.files.markdownFile,
          bibFile: result.files.bibFile,
          pdfStatusFile: result.files.pdfStatusFile,
          poolJsonFile: result.files.poolJsonFile,
          metaFile: result.files.metaFile,
          pdfDir: join(result.outputDir, 'pdfs')
        },
        metadataSummary: result.stats
      }
    };
  }
);

server.registerTool(
  'resolve_citations',
  {
    title: 'Resolve Citations',
    description: [
      'Resolve concrete citation strings from a text file into a lit-search literature pool.',
      'Use this when the user has references copied from a paper rather than broad keywords.',
      'This is the MCP equivalent of "lit-search resolve".',
      'The result is search-only by default; call download_pdfs afterwards if full-text PDF download is requested.'
    ].join(' '),
    inputSchema: {
      citationsFile: z.string().min(1).describe('Path to a UTF-8 text file containing numbered or bracketed citation lines.'),
      outputDir: z.string().optional().describe('Directory for the resolved literature pool. Default: ./resolved_literature.'),
      limit: z.number().optional().describe('Per-citation lookup limit. Default: 3.')
    }
  },
  async args => {
    logDebug(`tool resolve_citations args=${JSON.stringify(args)}`);
    const outputDir = resolve(args.outputDir || 'resolved_literature');
    const result = await resolveCitationsFile(args.citationsFile, {
      limit: normalizeOptionalNumber(args.limit) || 3,
      outputDir,
      apiKeys: getResolvedApiKeys(config),
      engines: config.get('engines') || {},
      logger: silentLogger
    });

    return {
      content: [
        {
          type: 'text',
          text: [
            'lit-search citation resolve completed.',
            '',
            `Result folder: ${outputDir}`,
            `Resolved: ${result.pool.papers.length}`,
            `Unresolved: ${result.unresolved.length}`,
            `Literature pool: ${result.files.literaturePoolFile}`,
            `BibTeX: ${result.files.bibFile}`,
            `PDF status: ${result.files.pdfStatusFile}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ...result.pool,
        output: {
          outputDir,
          literaturePoolFile: result.files.literaturePoolFile,
          markdownFile: result.files.markdownFile,
          bibFile: result.files.bibFile,
          pdfStatusFile: result.files.pdfStatusFile,
          poolJsonFile: result.files.poolJsonFile,
          metaFile: result.files.metaFile,
          pdfDir: join(outputDir, 'pdfs')
        },
        unresolved: result.unresolved
      }
    };
  }
);

const transport = new StdioServerTransport();
transport.onerror = error => {
  logDebug(`transport error: ${error.stack || error.message}`);
};
transport.onclose = () => {
  logDebug('transport closed');
};

await server.connect(transport);
logDebug('server connected');

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEnum(value, allowed, fallback) {
  if (!value) return fallback;
  return allowed.includes(value) ? value : fallback;
}

function buildAgentGuidance(query) {
  const originalQuery = String(query || '').trim();
  const hasComma = originalQuery.includes(',');
  const wordCount = originalQuery.split(/\s+/).filter(Boolean).length;
  const looksLikeLongConceptBag = !hasComma && wordCount >= 4;

  return {
    originalQuery,
    warning: looksLikeLongConceptBag
      ? 'This query looks like several concepts written as one phrase. For multiple keywords, call this MCP tool with comma-separated query text, e.g. query="ontology, knowledge graph, semantic web".'
      : null
  };
}

function buildMcpOutputSummary(workflow) {
  return [
    'lit-search completed.',
    '',
    'Local files created:',
    `- Literature pool: ${workflow.output.literaturePoolFile}`,
    `- BibTeX: ${workflow.output.bibFile}`,
    `- PDF status: ${workflow.output.pdfStatusFile}`,
    `- Machine-readable pool: ${workflow.output.poolJsonFile}`,
    `- PDFs: ${workflow.output.pdfDir}`,
    '',
    `PDF status: ${workflow.pdfSummary.downloaded}/${workflow.pdfSummary.total} downloaded, ${workflow.pdfSummary.failed} failed, ${workflow.pdfSummary.skipped} skipped.`,
    '',
    'Use literature_pool.md for readable paper summaries, references.bib for Zotero/EndNote/Mendeley citation import, pdf_status.md for PDF status, and the pdfs/ folder for downloaded full texts.',
    'If a PDF failed or has not been downloaded, inspect structuredContent.pdfSummary.results or pdf_status.md for the reason and suggested next action.',
    'Agent note: do not launch parallel lit-search calls for one research request; combine related concepts into one comma-separated query.'
  ].join('\n');
}

function logDebug(message) {
  if (!debugLogFile) return;
  try {
    mkdirSync(dirname(debugLogFile), { recursive: true });
    appendFileSync(debugLogFile, `[${new Date().toISOString()}] [lit-search-mcp] ${message}\n`, 'utf8');
  } catch {
    // Debug logging must never break the MCP protocol.
  }
}
