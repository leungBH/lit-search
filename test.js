#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import { renderOutput } from './lib/output.js';
import { generateQueries } from './lib/search.js';

const cliEntry = resolve(process.cwd(), 'bin/lit-search.js');
const mcpEntry = resolve(process.cwd(), 'bin/lit-search-mcp.js');
const localKeyFile = resolve(process.cwd(), 'temp/local-secrets/key.json');
const NETWORK_TIMEOUT_MS = 300000;

const networkTests = [
  {
    name: 'CLI folder output',
    args: ['machine learning', '-l', '2', '-s', '2022'],
    expect: { minResults: 1 }
  },
  {
    name: 'CLI title-only search',
    args: ['computer vision', '-l', '2', '-s', '2022', '--search-scope', 'title-only'],
    expect: { minResults: 1 }
  },
  {
    name: 'MCP tools/call',
    mcp: true,
    toolArgs: {
      query: 'natural language processing',
      limit: 2,
      yearStart: 2022,
      searchScope: 'title-abstract'
    },
    expect: { minResults: 1 }
  }
];

async function main() {
  console.log(chalk.bold.cyan('\nlit-search acceptance test\n'));

  const keyEnv = loadKeyEnv();
  const results = [];

  results.push(await runTest('CLI help', testCliHelp));
  results.push(await runTest('renderers', testRenderers));
  results.push(await runTest('query expansion', testQueryExpansion));
  results.push(await runTest('parallel source orchestration', testParallelSourceOrchestration));
  results.push(await runTest('MCP handshake', () => testMcpHandshake(keyEnv)));

  if (process.env.LIT_SEARCH_SKIP_NETWORK_TESTS === '1') {
    console.log(chalk.yellow('\nLIT_SEARCH_SKIP_NETWORK_TESTS=1. Skipping network tests.'));
  } else if (!hasAnyKeys(keyEnv)) {
    console.log(chalk.yellow('\nNo API keys found. Skipping network tests.'));
  } else {
    for (const test of networkTests) {
      results.push(await runTest(test.name, () => runNetworkTest(test, keyEnv)));
    }
  }

  printSummary(results);
  process.exit(results.some(item => !item.ok) ? 1 : 0);
}

async function runTest(name, fn) {
  console.log(`\n${chalk.bold('-'.repeat(64))}`);
  console.log(name);
  console.log('-'.repeat(64));

  try {
    await fn();
    console.log(chalk.green('PASS'));
    return { name, ok: true };
  } catch (error) {
    console.log(chalk.red('FAIL'));
    console.log(chalk.gray(error.stack || error.message));
    return { name, ok: false, error };
  }
}

function testCliHelp() {
  const output = execFileSync(process.execPath, [cliEntry, '--help'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'pipe'
  });

  assert.match(output, /lit-search init/);
  assert.match(output, /literature_pool\.md/);
  assert.match(output, /references\.bib/);
  assert.match(output, /pdf_status\.md/);
  assert.match(output, /--output-dir/);
  assert.match(output, /--pdf/);
  assert.doesNotMatch(output, /--format/);
}

function testRenderers() {
  const fixture = {
    metadata: {
      query: 'machine learning',
      queryExpansion: 'none',
      searchScope: 'title-abstract',
      keywords: ['machine learning'],
      yearRange: { start: 2022, end: 2024 },
      totalRetrieved: 3,
      afterDedup: 2,
      afterFilter: 2,
      finalCount: 1,
      engineStats: [{ engine: 'OpenAlex', status: 'success', totalPapers: 1 }]
    },
    papers: [
      {
        seq_id: 1,
        citation_key: 'Smith2024_1',
        entry_type: 'article',
        title: 'A Study on Machine Learning',
        author: 'Alice Smith and Bob Lee',
        authors: ['Alice Smith', 'Bob Lee', 'Carol Wang', 'David Kim'],
        year: 2024,
        journal: 'Journal of Examples',
        pages: '101-120',
        doi: '10.1000/example',
        url: 'https://doi.org/10.1000/example',
        pdf_url: 'https://example.com/paper.pdf',
        pdf_download: {
          status: 'failed',
          code: 'not_direct_pdf',
          message: 'The URL did not return a PDF file.',
          action: 'Treat this as a landing page.'
        },
        abstract: 'An example abstract.',
        keywords: ['machine learning', 'classification'],
        source: 'openalex',
        citation_count: 12
      }
    ]
  };

  const markdown = renderOutput(fixture, 'md');
  const bib = renderOutput(fixture, 'bib');

  assert.match(markdown, /# lit-search Results/);
  assert.match(markdown, /A Study on Machine Learning/);
  assert.match(markdown, /作者: Alice Smith, Bob Lee, Carol Wang, 等/);
  assert.match(markdown, /PDF: https:\/\/example\.com\/paper\.pdf/);
  assert.match(markdown, /备注: PDF 下载失败：not_direct_pdf/);
  assert.doesNotMatch(markdown, /PDF: .*not_direct_pdf/);
  assert.doesNotMatch(markdown, /Citation Count/);
  assert.match(bib, /@article\{Smith2024_1,/);
  assert.match(bib, /pdfurl = \{https:\/\/example\.com\/paper\.pdf\}/);
}

function testQueryExpansion() {
  assert.deepEqual(generateQueries('AI, coding, agent', [], 'none'), ['AI', 'coding', 'agent']);
  assert.deepEqual(generateQueries('AI, coding, agent', [], 'pairwise'), [
    'AI coding',
    'AI agent',
    'coding agent',
    'AI',
    'coding',
    'agent'
  ]);
  assert.deepEqual(generateQueries('AI, coding, agent', [], 'full'), [
    'AI coding agent',
    'AI coding',
    'AI agent',
    'coding agent',
    'AI',
    'coding',
    'agent'
  ]);
}

async function testMcpHandshake(env) {
  const responses = await interactWithMcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
  ], env);

  assert.equal(responses[0].result.serverInfo.name, 'lit-search-mcp');
  assert.equal(responses[1].result.tools[0].name, 'search_literature');
  assert.equal(responses[1].result.tools[0].inputSchema.properties.format, undefined);
  assert.ok(responses[1].result.tools[0].inputSchema.properties.outputDir);
  assert.ok(responses[1].result.tools[0].inputSchema.properties.downloadPdf);
}

function testParallelSourceOrchestration() {
  const source = readFileSync(resolve(process.cwd(), 'lib/search.js'), 'utf-8');
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /engineList\.map/);
  assert.match(source, /async function searchEngineQuery/);
  assert.match(source, /startProgressList/);
  assert.match(source, /正在检索的关键词/);
  assert.match(source, /SAME_SOURCE_QUERY_DELAY_MS = 1100/);
  assert.match(source, /setTimeout\(r, SAME_SOURCE_QUERY_DELAY_MS\)/);
}

async function runNetworkTest(test, env) {
  if (test.mcp) {
    const responses = await interactWithMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_literature', arguments: test.toolArgs } }
    ], env, NETWORK_TIMEOUT_MS);

    const toolResult = responses[1].result;
    assert.ok(toolResult.structuredContent);
    assert.ok(toolResult.structuredContent.papers.length >= test.expect.minResults);
    assert.ok(toolResult.structuredContent.output?.outputDir);
    assert.ok(existsSync(toolResult.structuredContent.output.markdownFile));
    assert.ok(existsSync(toolResult.structuredContent.output.bibFile));
    assert.ok(existsSync(toolResult.structuredContent.output.pdfDir));
    assert.ok(toolResult.structuredContent.pdfSummary);
    assert.equal(toolResult.content.length, 3);
    assert.match(toolResult.content[0].text, /Local files created:/);
    assert.match(toolResult.content[0].text, /references\.bib/);
    assert.match(toolResult.content[0].text, /pdf_status\.md/);
    assert.match(toolResult.content[0].text, /pdfs/);
    assert.match(toolResult.content[1].text, /# lit-search Results/);
    assert.match(toolResult.content[2].text, /^% lit-search results/m);
    rmSync(toolResult.structuredContent.output.outputDir, { recursive: true, force: true });
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-acceptance-'));

  try {
    execFileSync(process.execPath, [cliEntry, ...test.args], {
      cwd: tempDir,
      encoding: 'utf-8',
      timeout: NETWORK_TIMEOUT_MS,
      stdio: 'pipe',
      env: { ...process.env, ...env }
    });

    const outputDir = findNewestOutputDir(tempDir);
    assert.ok(outputDir, 'No output directory found.');
    assert.ok(existsSync(join(outputDir, 'literature_pool.md')));
    assert.ok(existsSync(join(outputDir, 'references.bib')));
    assert.ok(existsSync(join(outputDir, 'pdf_status.md')));
    assert.ok(existsSync(join(outputDir, 'literature_pool.json')));
    assert.ok(existsSync(join(outputDir, 'pdfs')));

    const markdown = readFileSync(join(outputDir, 'literature_pool.md'), 'utf-8');
    const bib = readFileSync(join(outputDir, 'references.bib'), 'utf-8');
    assert.match(markdown, /Final count:/);
    assert.match(bib, /^% lit-search results/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function findNewestOutputDir(dir) {
  const directories = readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => join(dir, item.name));
  return directories.sort().at(-1) || null;
}

function loadKeyEnv() {
  const env = {};
  if (process.env.LIT_SEARCH_S2_API_KEY) env.LIT_SEARCH_S2_API_KEY = process.env.LIT_SEARCH_S2_API_KEY;
  if (process.env.LIT_SEARCH_OPENALEX_API_KEY) env.LIT_SEARCH_OPENALEX_API_KEY = process.env.LIT_SEARCH_OPENALEX_API_KEY;
  if (process.env.LIT_SEARCH_CROSSREF_MAILTO) env.LIT_SEARCH_CROSSREF_MAILTO = process.env.LIT_SEARCH_CROSSREF_MAILTO;
  if (process.env.LIT_SEARCH_CORE_API_KEY) env.LIT_SEARCH_CORE_API_KEY = process.env.LIT_SEARCH_CORE_API_KEY;

  if (!hasAnyKeys(env) && existsSync(localKeyFile)) {
    const parsed = JSON.parse(readFileSync(localKeyFile, 'utf-8'));
    if (parsed.s2) env.LIT_SEARCH_S2_API_KEY = parsed.s2;
    if (parsed.openalex) env.LIT_SEARCH_OPENALEX_API_KEY = parsed.openalex;
    if (parsed.crossrefMailto) env.LIT_SEARCH_CROSSREF_MAILTO = parsed.crossrefMailto;
    if (parsed.core) env.LIT_SEARCH_CORE_API_KEY = parsed.core;
  }

  return env;
}

function hasAnyKeys(env) {
  return Boolean(
    env.LIT_SEARCH_S2_API_KEY ||
    env.LIT_SEARCH_OPENALEX_API_KEY ||
    env.LIT_SEARCH_CROSSREF_MAILTO ||
    env.LIT_SEARCH_CORE_API_KEY
  );
}

async function interactWithMcp(messages, env, timeoutMs = 30000) {
  const child = spawn(process.execPath, [mcpEntry], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...env }
  });

  let buffer = Buffer.alloc(0);
  const responses = [];

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function readMessages() {
    while (true) {
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd === -1) return;
      const body = buffer.slice(0, lineEnd).toString('utf8').trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!body) continue;
      responses.push(JSON.parse(body));
    }
  }

  return await new Promise((resolve, reject) => {
    const expectedResponses = messages.filter(message => message.id !== undefined).length;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP response timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        readMessages();
        if (responses.length >= expectedResponses) {
          clearTimeout(timer);
          child.kill();
          resolve(responses);
        }
      } catch (error) {
        clearTimeout(timer);
        child.kill();
        reject(error);
      }
    });

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    for (const message of messages) send(message);
  });
}

function printSummary(results) {
  const passed = results.filter(item => item.ok).length;
  const failed = results.length - passed;
  console.log(`\n${chalk.bold('-'.repeat(64))}`);
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed) console.log(chalk.red(`Failed: ${failed}/${results.length}`));
  console.log('-'.repeat(64));
}

main().catch(error => {
  console.error(chalk.red(error.stack || error.message));
  process.exit(1);
});
