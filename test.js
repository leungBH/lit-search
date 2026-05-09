#!/usr/bin/env node

/**
 * lit-search 验收测试
 *
 * 分为两部分：
 * 1. 静态/协议测试：不依赖外部网络
 * 2. 联调测试：真实调用 CLI / MCP，依赖网络和外部学术 API
 */

import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import assert from 'assert/strict';
import chalk from 'chalk';
import { renderOutput } from './lib/output.js';
import { generateQueries } from './lib/search.js';

const cliEntry = resolve(process.cwd(), 'bin/lit-search.js');
const mcpEntry = resolve(process.cwd(), 'bin/lit-search-mcp.js');
const localKeyFile = resolve(process.cwd(), 'temp/local-secrets/key.json');
const NETWORK_TIMEOUT_MS = 300000;

const networkTests = [
  {
    name: 'CLI JSON 输出 + 起始年份过滤',
    args: ['machine learning', '-l', '3', '-s', '2022', '--format', 'json'],
    expect: { format: 'json', minResults: 1, yearMin: 2022 }
  },
  {
    name: 'CLI BibTeX 输出',
    args: ['attention mechanism', '-l', '2', '-s', '2023', '--format', 'bib'],
    expect: { format: 'bib', minResults: 1 }
  },
  {
    name: 'CLI title-only 检索',
    args: ['computer vision', '-l', '3', '-s', '2022', '--search-scope', 'title-only', '--format', 'json'],
    expect: { format: 'json', minResults: 1, yearMin: 2022 }
  },
  {
    name: 'MCP tools/call 返回结构化结果',
    mcp: true,
    toolArgs: {
      query: 'natural language processing',
      limit: 2,
      yearStart: 2022,
      format: 'json',
      searchScope: 'title-abstract'
    },
    expect: { minResults: 1, yearMin: 2022 }
  }
];

async function main() {
  console.log(chalk.bold.cyan('\n🧪 lit-search 验收测试\n'));

  const keyEnv = loadKeyEnv();
  const results = [];

  results.push(await runStaticTest('CLI help', testCliHelp));
  results.push(await runStaticTest('渲染器输出', testRenderers));
  results.push(await runStaticTest('查询展开逻辑', testQueryExpansion));
  results.push(await runStaticTest('MCP 握手', () => testMcpHandshake(keyEnv)));

  if (!hasAnyKeys(keyEnv)) {
    console.log(chalk.yellow('\n⚠️ 未检测到 API Key。跳过联调测试。'));
    console.log(chalk.gray(`   可通过环境变量或本地文件提供：${localKeyFile}`));
  } else {
    for (const test of networkTests) {
      results.push(await runStaticTest(test.name, () => runNetworkTest(test, keyEnv)));
    }
  }

  printSummary(results);
  const failed = results.filter(item => !item.ok);
  process.exit(failed.length > 0 ? 1 : 0);
}

async function runStaticTest(name, fn) {
  console.log(`\n${chalk.bold('━'.repeat(64))}`);
  console.log(`📋 ${name}`);
  console.log('─'.repeat(64));

  try {
    await fn();
    console.log(chalk.green('✅ 通过'));
    return { name, ok: true };
  } catch (error) {
    console.log(chalk.red('❌ 失败'));
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
  assert.match(output, /md\|json\|bib/);
  assert.match(output, /title-only\|title-abstract\|default-engine-search/);
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
        authors: ['Alice Smith', 'Bob Lee'],
        year: 2024,
        journal: 'Journal of Examples',
        pages: '101-120',
        doi: '10.1000/example',
        url: 'https://doi.org/10.1000/example',
        abstract: 'An example abstract.',
        keywords: ['machine learning', 'classification'],
        source: 'openalex',
        citation_count: 12
      }
    ]
  };

  const markdown = renderOutput(fixture, 'md');
  const json = renderOutput(fixture, 'json');
  const bib = renderOutput(fixture, 'bib');

  assert.match(markdown, /# lit-search Results/);
  assert.match(markdown, /A Study on Machine Learning/);

  const parsed = JSON.parse(json);
  assert.equal(parsed.papers.length, 1);
  assert.equal(parsed.papers[0].citation_key, 'Smith2024_1');

  assert.match(bib, /@article\{Smith2024_1,/);
  assert.match(bib, /title = \{A Study on Machine Learning\}/);
  assert.match(bib, /doi = \{10\.1000\/example\}/);
}

function testQueryExpansion() {
  assert.deepEqual(
    generateQueries('AI, coding, agent', [], 'none'),
    ['AI', 'coding', 'agent']
  );

  assert.deepEqual(
    generateQueries('AI, coding, agent', [], 'pairwise'),
    ['AI coding', 'AI agent', 'coding agent', 'AI', 'coding', 'agent']
  );

  assert.deepEqual(
    generateQueries('AI, coding, agent', [], 'full'),
    ['AI coding agent', 'AI coding', 'AI agent', 'coding agent', 'AI', 'coding', 'agent']
  );
}

async function testMcpHandshake(env) {
  const response = await interactWithMcp(
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    ],
    env
  );

  assert.equal(response[0].result.serverInfo.name, 'lit-search-mcp');
  assert.equal(response[1].result.tools[0].name, 'search_literature');
}

async function runNetworkTest(test, env) {
  if (test.mcp) {
    const response = await interactWithMcp(
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_literature', arguments: test.toolArgs } }
      ],
      env,
      NETWORK_TIMEOUT_MS
    );

    const toolCall = response[1].result;
    const structured = toolCall.structuredContent;
    assert.ok(structured);
    assert.ok(Array.isArray(structured.papers));
    assert.ok(structured.papers.length >= test.expect.minResults);
    assertYears(structured.papers, test.expect.yearMin, test.expect.yearMax);
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-acceptance-'));

  try {
    execFileSync(process.execPath, [cliEntry, ...test.args], {
      encoding: 'utf-8',
      cwd: tempDir,
      timeout: NETWORK_TIMEOUT_MS,
      stdio: 'pipe',
      env: { ...process.env, ...env }
    });

    const outputFile = findOutputFileByQuery(tempDir, test.args[0], test.expect.format);
    assert.ok(outputFile, `未找到输出文件: ${test.args[0]}`);

    if (test.expect.format === 'bib') {
      const bib = readFileSync(outputFile, 'utf-8');
      assert.match(bib, /^% lit-search results/m);
      assert.match(bib, /^@/m);
      return;
    }

    const result = JSON.parse(readFileSync(outputFile, 'utf-8'));
    assert.ok(result.papers.length >= test.expect.minResults, `结果数不足: ${result.papers.length}`);
    assertYears(result.papers, test.expect.yearMin, test.expect.yearMax);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertYears(papers, yearMin, yearMax) {
  if (yearMin) {
    const invalid = papers.filter(p => p.year && p.year < yearMin);
    assert.equal(invalid.length, 0, `发现 ${invalid.length} 篇年份早于 ${yearMin}`);
  }

  if (yearMax) {
    const invalid = papers.filter(p => p.year && p.year > yearMax);
    assert.equal(invalid.length, 0, `发现 ${invalid.length} 篇年份晚于 ${yearMax}`);
  }
}

function findOutputFileByQuery(dir, query, format) {
  const ext = format === 'bib' ? '.bib' : format === 'json' ? '.json' : '.md';
  const normalizedQuery = query
    .split(',')
    .map(k => k.trim())
    .join('_')
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '');

  return readdirSync(dir).find(file => file.includes(normalizedQuery) && file.endsWith(ext))
    ? join(dir, readdirSync(dir).find(file => file.includes(normalizedQuery) && file.endsWith(ext)))
    : null;
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
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    child.stdin.write(payload);
  }

  function tryReadMessages() {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = buffer.slice(0, headerEnd).toString('utf8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        throw new Error('MCP 响应缺少 Content-Length');
      }

      const bodyLength = Number(match[1]);
      const messageEnd = headerEnd + 4 + bodyLength;
      if (buffer.length < messageEnd) return;

      const body = buffer.slice(headerEnd + 4, messageEnd).toString('utf8');
      buffer = buffer.slice(messageEnd);
      responses.push(JSON.parse(body));
    }
  }

  return await new Promise((resolve, reject) => {
    const expectedResponses = messages.filter(msg => msg.id !== undefined).length;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP 响应超时（${timeoutMs}ms）`));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        tryReadMessages();
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

    child.on('exit', code => {
      if (responses.length < expectedResponses) {
        clearTimeout(timer);
        reject(new Error(`MCP 进程提前退出，exit code=${code}`));
      }
    });

    for (const message of messages) {
      send(message);
    }
  });
}

function printSummary(results) {
  const passed = results.filter(item => item.ok).length;
  const failed = results.length - passed;

  console.log(`\n${chalk.bold('━'.repeat(64))}`);
  console.log(chalk.bold('📊 验收总结'));
  console.log('─'.repeat(64));
  console.log(chalk.green(`  ✅ 通过: ${passed}/${results.length}`));
  if (failed > 0) {
    console.log(chalk.red(`  ❌ 失败: ${failed}/${results.length}`));
  }
  console.log('━'.repeat(64) + '\n');
}

main().catch(error => {
  console.error(chalk.red(error.stack || error.message));
  process.exit(1);
});
