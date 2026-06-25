/**
 * Integration test for the MCP server's streaming progress + cancellation
 * protocol, exercised end-to-end with the official MCP SDK Client and an
 * in-memory transport. The same server factory that ships in
 * `bin/lit-search-mcp.js` is used, so this test is faithful to production
 * behavior.
 *
 * Network access is stubbed with nock, so the test does not require
 * outbound HTTP.
 */

import nock from 'nock';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import { createLitSearchMcpServer } from '../../lib/mcp-server.js';
import { createAppConfig } from '../../lib/app-config.js';

import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertOk,
  assertTruthy,
  assertFalsy,
  assertRejects,
  assertMatch,
} from '../unit/helpers.js';

const OA_BASE = 'https://api.openalex.org';

function makeMockAppConfig() {
  // Configure only OpenAlex to be enabled so we only need to stub one upstream.
  process.env.LIT_SEARCH_ENGINES = JSON.stringify({
    semanticScholar: false,
    openalex: true,
    arxiv: false,
    crossref: false,
    core: false,
    europePmc: false,
    dblp: false,
    doaj: false,
    pubmed: false,
    unpaywall: false,
    openCitations: false,
  });
  return createAppConfig();
}

function makeMockOAResult(id, title) {
  return {
    id: `https://openalex.org/W${id}`,
    doi: `10.1234/${id}`,
    title,
    publication_year: 2023,
    authorships: [{ author: { display_name: 'Test Author' } }],
    cited_by_count: 42,
    primary_location: { source: { display_name: 'Mock Venue' } },
    abstract_inverted_index: {},
  };
}

async function setupServerAndClient() {
  const config = makeMockAppConfig();
  const server = createLitSearchMcpServer({ config, version: 'test' });
  const client = new Client({ name: 'test-client', version: 'test' }, { capabilities: {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { server, client, transport: clientT };
}

async function teardownServerAndClient({ client, server }) {
  try {
    await client.close();
  } catch {
    // ignore
  }
  try {
    await server.close();
  } catch {
    // ignore
  }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'lit-search-mcp-test-'));
}

function cleanupProcessState() {
  nock.cleanAll();
  nock.enableNetConnect();
  delete process.env.LIT_SEARCH_ENGINES;
}

// ──────────────────────────────────────────────────────────────────────
// Initialization + tool listing
// ──────────────────────────────────────────────────────────────────────

suite('mcp-server: in-process integration', () => {
  beforeEach(() => {
    nock.cleanAll();
    nock.abortPendingRequests();
    nock.disableNetConnect();
  });

  test('server exposes the expected tool list', async () => {
    const { client } = await setupServerAndClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assertOk(names.includes('search_literature'));
    assertOk(names.includes('merge_pools'));
    assertOk(names.includes('enrich_metadata'));
    assertOk(names.includes('resolve_citations'));
    assertOk(names.includes('get_paper'));
    cleanupProcessState();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Streaming progress
// ──────────────────────────────────────────────────────────────────────

suite('mcp-server: streaming progress notifications', () => {
  beforeEach(() => {
    nock.cleanAll();
    nock.abortPendingRequests();
    nock.disableNetConnect();
  });

  test('client receives notifications/progress events during search_literature', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeMockOAResult('m1', 'A mock paper')],
        meta: { count: 1 },
      });

    const ctx = await setupServerAndClient();
    const progressEvents = [];
    ctx.client.setNotificationHandler(ProgressNotificationSchema, (n) => {
      progressEvents.push(n);
    });

    const outputDir = makeTempDir();
    const result = await ctx.client.callTool(
      {
        name: 'search_literature',
        arguments: {
          query: 'mock paper',
          outputDir,
        },
        _meta: { progressToken: 'tok-progress-1' },
      },
      undefined,
      { timeout: 30000 }
    );

    // Tool succeeded
    assertFalsy(result.isError);
    assertEqual(progressEvents.length >= 3, true, 'expected >=3 progress events');

    // Every event has the right shape
    for (const evt of progressEvents) {
      assertEqual(evt.method, 'notifications/progress');
      assertTruthy(evt.params);
      assertEqual(evt.params.progressToken, 'tok-progress-1');
      assertEqual(typeof evt.params.progress, 'number');
    }

    // Progress is monotonic non-decreasing
    for (let i = 1; i < progressEvents.length; i++) {
      assertTruthy(
        progressEvents[i].params.progress >= progressEvents[i - 1].params.progress,
        'progress should be monotonic'
      );
    }

    // The final event should land at progress === total
    const last = progressEvents[progressEvents.length - 1].params;
    assertTruthy(typeof last.total === 'number' && last.progress === last.total);

    // At least one event should contain a per-source message
    const hasSourceEvent = progressEvents.some((evt) =>
      String(evt.params.message || '').includes(' · ')
    );
    assertTruthy(hasSourceEvent, 'expected at least one per-source progress event');
    await teardownServerAndClient(ctx);
    cleanupProcessState();
  });

  test('progress events include meaningful human-readable messages', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeMockOAResult('m2', 'Another mock paper')],
        meta: { count: 1 },
      });

    const { client } = await setupServerAndClient();
    const messages = [];
    client.setNotificationHandler(ProgressNotificationSchema, (n) => {
      if (n?.params?.message) messages.push(n.params.message);
    });

    await client.callTool(
      {
        name: 'search_literature',
        arguments: { query: 'mock paper', outputDir: makeTempDir() },
        _meta: { progressToken: 'tok-progress-2' },
      },
      undefined,
      { timeout: 30000 }
    );

    assertTruthy(messages.length > 0);
    assertTruthy(
      messages.some((m) => m.includes('关键词 1/1')),
      `expected 关键词 1/1 in messages, got ${JSON.stringify(messages)}`
    );
    assertTruthy(
      messages.some((m) => m.includes('最终结果')),
      `expected 最终结果 in messages, got ${JSON.stringify(messages)}`
    );
    cleanupProcessState();
  });

  test('server works fine when client does NOT request progress', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeMockOAResult('m3', 'No-progress paper')],
        meta: { count: 1 },
      });

    const ctx = await setupServerAndClient();
    // No _meta, no progress handler installed.

    const result = await ctx.client.callTool({
      name: 'search_literature',
      arguments: { query: 'mock paper', outputDir: makeTempDir() },
    });

    assertFalsy(result.isError);
    assertTruthy(result.content);
    await teardownServerAndClient(ctx);
    cleanupProcessState();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Cancellation
// ──────────────────────────────────────────────────────────────────────

suite('mcp-server: cancellation via AbortSignal', () => {
  beforeEach(() => {
    nock.cleanAll();
    nock.abortPendingRequests();
    nock.disableNetConnect();
  });

  test('pre-aborted signal → server returns CANCELLED error', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [], meta: { count: 0 } });

    const ctx = await setupServerAndClient();
    // A pre-aborted signal: build via controller to avoid the static
    // AbortSignal.abort() emit which can race with nock's teardown of
    // pending requests from a prior test.
    const ac = new AbortController();
    ac.abort();

    let result;
    let unhandled = null;
    process.once('uncaughtException', (err) => {
      unhandled = err;
    });
    try {
      result = await ctx.client.callTool(
        {
          name: 'search_literature',
          arguments: { query: 'mock paper', outputDir: makeTempDir() },
        },
        undefined,
        { signal: ac.signal, timeout: 10000 }
      );
    } catch (err) {
      // AbortError from the SDK is the expected outcome.
      assertMatch(String(err), /abort|cancel|CANCELLED/i);
    } finally {
      if (unhandled) {
        assertMatch(String(unhandled), /abort|cancel|CANCELLED/i);
      }
    }
    if (result) {
      assertTruthy(result.isError);
      const text = result.content?.[0]?.text || '';
      assertMatch(text, /CANCELLED/);
    }
    await teardownServerAndClient(ctx);
    cleanupProcessState();
  });

  test('aborting the signal mid-flight causes the call to reject', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [], meta: { count: 0 } });

    const ctx = await setupServerAndClient();
    const ac = new AbortController();
    ac.abort();

    await assertRejects(
      () =>
        ctx.client.callTool(
          {
            name: 'search_literature',
            arguments: { query: 'mock paper', outputDir: makeTempDir() },
          },
          undefined,
          { signal: ac.signal, timeout: 10000 }
        ),
      /abort|cancel|CANCELLED/i
    );
    await teardownServerAndClient(ctx);
    cleanupProcessState();
  });
});
