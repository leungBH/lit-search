#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runLitSearchWorkflow } from '../lib/workflow.js';
import { enrichMetadata, mergePools, resolveCitationsFile } from '../lib/pool-ops.js';
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
      'Search academic literature across Semantic Scholar, OpenAlex, arXiv, CrossRef, CORE, Europe PMC, DBLP, and DOAJ. PubMed can be enabled in configuration.',
      'Every call creates a local result folder with exactly three default files: search_meta.json, literature_pool.json, and references.bib.',
      'search_meta.json records the query, keywords, time range, source list, timestamps, and retrieval statistics for reproducibility.',
      'literature_pool.json is the complete machine-readable result set. references.bib is a LaTeX-friendly BibTeX export.',
      'Unpaywall may enrich DOI records with open-access status and PDF candidates when an email is configured. OpenCitations is an optional citation-relation enhancer, not a normal keyword search source.',
      'PDF downloading is intentionally not supported by lit-search.',
      'lit-search already searches enabled literature sources inside one tool call; do not split one research request into parallel lit-search subtasks.',
      'Use comma-separated query text such as "ontology, knowledge graph, semantic web".',
      'Do not send a long space-separated bag of concepts such as "ontology knowledge graph semantic web"; that is interpreted as one phrase and may over-filter results.',
      'Use resolvePreprint and preferPublished when citations should prefer formal publication metadata over arXiv preprint metadata.',
      'Use outputDir to choose the parent directory where the generated result folder will be created.'
    ].join(' '),
    inputSchema: {
      query: z.string().min(1).describe('Search query. For multiple concepts, prefer comma-separated terms, e.g. "ontology, knowledge graph, semantic web".'),
      limit: z.number().optional().describe('Per-keyword, per-source retrieval limit. Default: 3.'),
      yearStart: z.number().optional().describe('Inclusive start year.'),
      yearEnd: z.number().optional().describe('Inclusive end year.'),
      queryExpansion: z.enum(['none', 'pairwise', 'full']).optional().describe('Query expansion strategy. Default none.'),
      searchScope: z.enum(['title-only', 'title-abstract', 'default-engine-search']).optional().describe('Search scope strategy. Default default-engine-search.'),
      resolvePreprint: z.boolean().optional().describe('Resolve arXiv preprints to formal publication metadata when possible. Default false.'),
      preferPublished: z.boolean().optional().describe('Prefer formal publication metadata for top-level citation fields and BibTeX. Implies resolvePreprint. Default false.'),
      withPubMed: z.boolean().optional().describe('Enable optional PubMed/NCBI search for this call. Default false.'),
      withOpenCitations: z.boolean().optional().describe('Enable optional OpenCitations DOI relation enrichment for this call. Default false.'),
      outputDir: z.string().optional().describe('Parent directory for generated result folders.')
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
      searchScope: normalizeEnum(args.searchScope, ['title-only', 'title-abstract', 'default-engine-search'], 'default-engine-search'),
      resolvePreprint: args.resolvePreprint === true || args.preferPublished === true,
      preferPublished: args.preferPublished === true,
      apiKeys: getResolvedApiKeys(config),
      engines: buildRuntimeEngines(args),
      logger: silentLogger,
      outputBaseDir: args.outputDir || process.cwd()
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
          text: workflow.bibtex
        }
      ],
      structuredContent: {
        ...workflow.result,
        output: workflow.output
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
      'Inputs can be result folders or literature_pool.json files.',
      'Merging writes search_meta.json, literature_pool.json, and references.bib into outputDir.',
      'Use resolvePreprint and preferPublished when merged citation exports should prefer formal publication metadata.'
    ].join(' '),
    inputSchema: {
      inputs: z.array(z.string().min(1)).min(1).describe('Pool paths to merge.'),
      outputDir: z.string().optional().describe('Directory for the merged pool. Default: ./merged_literature.'),
      resolvePreprint: z.boolean().optional().describe('Resolve arXiv preprints to formal publication metadata when possible. Default false.'),
      preferPublished: z.boolean().optional().describe('Prefer formal publication metadata for top-level citation fields and BibTeX. Implies resolvePreprint. Default false.'),
      withOpenCitations: z.boolean().optional().describe('Enable optional OpenCitations DOI relation enrichment while merging. Default false.')
    }
  },
  async args => {
    logDebug(`tool merge_pools args=${JSON.stringify(args)}`);
    const outputDir = resolve(args.outputDir || 'merged_literature');
    const result = await mergePools(args.inputs, outputDir, {
      resolvePreprint: args.resolvePreprint === true || args.preferPublished === true,
      preferPublished: args.preferPublished === true,
      apiKeys: getResolvedApiKeys(config),
      logger: silentLogger,
      engines: buildRuntimeEngines(args)
    });

    return {
      content: [
        {
          type: 'text',
          text: [
            `Merged ${args.inputs.length} pool(s).`,
            '',
            `Result folder: ${outputDir}`,
            `Papers: ${result.pool.papers.length}`,
            `Search metadata: ${result.files.metaFile}`,
            `Literature pool: ${result.files.poolJsonFile}`,
            `BibTeX: ${result.files.bibFile}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ...result.pool,
        output: buildOutputObject(outputDir, result.files)
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
      'Input can be a result folder or literature_pool.json.',
      'It looks up missing fields by arXiv ID, DOI via OpenAlex and Semantic Scholar, source IDs, then title fallback.',
      'It rewrites search_meta.json, literature_pool.json, and references.bib in place.',
      'For agent workflows that only need abstracts, call with fields="abstract", onlyMissing=true, concurrency=1, and checkpointInterval=5.',
      'Do not run multiple enrich_metadata calls in parallel for the same pool.'
    ].join(' '),
    inputSchema: {
      poolPath: z.string().min(1).describe('Path to a lit-search result folder or literature_pool.json file.'),
      fields: z.string().optional().describe('Comma-separated fields to enrich. Default: all supported metadata fields.'),
      onlyMissing: z.boolean().optional().describe('Only fill missing requested fields.'),
      checkpointInterval: z.number().optional().describe('Save progress every n processed papers. Default: 5. Use 0 to disable checkpoint writes.'),
      concurrency: z.number().optional().describe('Paper-level enrichment concurrency. Default: 1.'),
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
            `Search metadata: ${result.files.metaFile}`,
            `Literature pool: ${result.files.poolJsonFile}`,
            `BibTeX: ${result.files.bibFile}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ...result.pool,
        output: buildOutputObject(result.outputDir, result.files),
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
      'The result folder contains search_meta.json, literature_pool.json, and references.bib.'
    ].join(' '),
    inputSchema: {
      citationsFile: z.string().min(1).describe('Path to a UTF-8 text file containing numbered or bracketed citation lines.'),
      outputDir: z.string().optional().describe('Directory for the resolved literature pool. Default: ./resolved_literature.'),
      limit: z.number().optional().describe('Per-citation lookup limit. Default: 3.'),
      resolvePreprint: z.boolean().optional().describe('Resolve arXiv preprints to formal publication metadata when possible. Default false.'),
      preferPublished: z.boolean().optional().describe('Prefer formal publication metadata for top-level citation fields and BibTeX. Implies resolvePreprint. Default false.'),
      withPubMed: z.boolean().optional().describe('Enable optional PubMed/NCBI search for citation resolving. Default false.'),
      withOpenCitations: z.boolean().optional().describe('Enable optional OpenCitations DOI relation enrichment. Default false.')
    }
  },
  async args => {
    logDebug(`tool resolve_citations args=${JSON.stringify(args)}`);
    const outputDir = resolve(args.outputDir || 'resolved_literature');
    const result = await resolveCitationsFile(args.citationsFile, {
      limit: normalizeOptionalNumber(args.limit) || 3,
      outputDir,
      apiKeys: getResolvedApiKeys(config),
      engines: buildRuntimeEngines(args),
      logger: silentLogger,
      resolvePreprint: args.resolvePreprint === true || args.preferPublished === true,
      preferPublished: args.preferPublished === true
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
            `Search metadata: ${result.files.metaFile}`,
            `Literature pool: ${result.files.poolJsonFile}`,
            `BibTeX: ${result.files.bibFile}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ...result.pool,
        output: buildOutputObject(outputDir, result.files),
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

function buildRuntimeEngines(args = {}) {
  return {
    ...(config.get('engines') || {}),
    ...(args.withPubMed === true ? { pubmed: true } : {}),
    ...(args.withOpenCitations === true ? { openCitations: true } : {})
  };
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

function buildOutputObject(outputDir, files) {
  return {
    outputDir,
    metaFile: files.metaFile,
    poolJsonFile: files.poolJsonFile,
    bibFile: files.bibFile,
    files: [
      { type: 'json', role: 'search_metadata', path: files.metaFile },
      { type: 'json', role: 'literature_pool', path: files.poolJsonFile },
      { type: 'bibtex', role: 'citation_export', path: files.bibFile }
    ]
  };
}

function buildMcpOutputSummary(workflow) {
  const publication = workflow.result.metadata?.publicationResolution;
  const publicationLines = publication?.enabled ? [
    '',
    'Publication resolution:',
    `- Attempted: ${publication.attempted}`,
    `- Published metadata resolved: ${publication.resolvedPublished}`,
    `- Preprint only: ${publication.preprintOnly}`
  ] : [];
  return [
    'lit-search completed.',
    '',
    'Local files created:',
    `- Search metadata: ${workflow.output.metaFile}`,
    `- Literature pool: ${workflow.output.poolJsonFile}`,
    `- BibTeX: ${workflow.output.bibFile}`,
    ...publicationLines,
    '',
    'Use search_meta.json to reproduce the search, literature_pool.json for complete machine-readable results, and references.bib for LaTeX/reference-manager import.',
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
