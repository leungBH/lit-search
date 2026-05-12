#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runLitSearchWorkflow } from '../lib/workflow.js';
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
      'The folder always contains results.md, references.bib, and a pdfs/ subfolder for downloaded PDFs.',
      'Read structuredContent.output for outputDir, markdownFile, bibFile, and pdfDir.',
      'Read structuredContent.pdfSummary for PDF download success/failure diagnostics.',
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
      outputDir: z.string().optional().describe('Parent directory for generated result folders. The tool still creates a timestamped result folder containing results.md, references.bib, and pdfs/.')
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
    `- Markdown: ${workflow.output.markdownFile}`,
    `- BibTeX: ${workflow.output.bibFile}`,
    `- PDFs: ${workflow.output.pdfDir}`,
    '',
    `PDF downloads: ${workflow.pdfSummary.downloaded}/${workflow.pdfSummary.total} downloaded, ${workflow.pdfSummary.failed} failed, ${workflow.pdfSummary.skipped} skipped.`,
    '',
    'Use results.md for readable paper summaries, references.bib for Zotero/EndNote/Mendeley citation import, and the pdfs/ folder for downloaded full texts.',
    'If a PDF failed, inspect structuredContent.pdfSummary.results or the PDF field in results.md for the failure reason and suggested next action.',
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
