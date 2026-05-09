#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { searchPapers } from '../lib/search.js';
import { renderOutput } from '../lib/output.js';
import { createAppConfig, getResolvedApiKeys } from '../lib/app-config.js';
import { silentLogger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
const protocolVersion = '2024-11-05';
const config = createAppConfig();

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', chunk => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processBuffer();
});

process.stdin.on('end', () => process.exit(0));

function processBuffer() {
  while (true) {
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headerText = inputBuffer.slice(0, headerEnd).toString('utf8');
    const contentLength = parseContentLength(headerText);
    if (contentLength === null) {
      inputBuffer = Buffer.alloc(0);
      return;
    }

    const messageEnd = headerEnd + 4 + contentLength;
    if (inputBuffer.length < messageEnd) return;

    const messageText = inputBuffer.slice(headerEnd + 4, messageEnd).toString('utf8');
    inputBuffer = inputBuffer.slice(messageEnd);

    try {
      const message = JSON.parse(messageText);
      handleMessage(message).catch(error => {
        if (message?.id !== undefined) {
          sendError(message.id, -32603, error.message || 'Internal error');
        }
      });
    } catch (error) {
      // Ignore malformed payloads.
    }
  }
}

function parseContentLength(headerText) {
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function handleMessage(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion,
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'lit-search-mcp',
        version: packageJson.version
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    sendResult(id, {
      tools: [
        {
          name: 'search_literature',
          description: 'Search academic literature across Semantic Scholar, OpenAlex, arXiv, CrossRef, and CORE.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query or comma-separated keywords.' },
              limit: { type: 'number', description: 'Per-keyword, per-source retrieval limit.', default: 3 },
              yearStart: { type: 'number', description: 'Inclusive start year.' },
              yearEnd: { type: 'number', description: 'Inclusive end year.' },
              format: { type: 'string', enum: ['md', 'json', 'bib'], default: 'md' },
              queryExpansion: { type: 'string', enum: ['none', 'pairwise', 'full'], default: 'none' },
              searchScope: { type: 'string', enum: ['title-only', 'title-abstract', 'default-engine-search'], default: 'default-engine-search' }
            },
            required: ['query']
          }
        }
      ]
    });
    return;
  }

  if (method === 'tools/call') {
    const result = await callTool(params);
    sendResult(id, result);
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(params) {
  const { name, arguments: args = {} } = params || {};

  if (name !== 'search_literature') {
    throw new Error(`Unknown tool: ${name}`);
  }

  const query = String(args.query || '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const apiKeys = loadApiKeys();
  const result = await searchPapers({
    query,
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
    apiKeys,
    logger: silentLogger
  });

  const format = normalizeEnum(args.format, ['md', 'json', 'bib'], 'md');
  const rendered = renderOutput(result, format);

  return {
    content: [
      {
        type: 'text',
        text: rendered
      }
    ],
    structuredContent: result
  };
}

function loadApiKeys() {
  return getResolvedApiKeys(config);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEnum(value, allowed, fallback) {
  if (!value) return fallback;
  return allowed.includes(value) ? value : fallback;
}

function sendResult(id, result) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    result
  });
}

function sendError(id, code, message) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });
}

function sendMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}
