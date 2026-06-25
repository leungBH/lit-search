#!/usr/bin/env node
// Stdio entry point for the lit-search MCP server.
//
// All tool registration, validation, and per-request behavior live in
// lib/mcp-server.js so the same server setup can be reused in tests via
// an in-process transport.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAppConfig } from '../lib/app-config.js';
import { createLitSearchMcpServer } from '../lib/mcp-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
const config = createAppConfig();
const debugLogFile =
  process.env.LIT_SEARCH_MCP_DEBUG_FILE ||
  (process.env.LIT_SEARCH_MCP_DEBUG === '1' ? join(packageRoot, 'temp', 'mcp-debug.log') : null);

const server = createLitSearchMcpServer({
  config,
  version: packageJson.version,
  debugLogFile,
});

const transport = new StdioServerTransport();
transport.onerror = (error) => {
  console.error(`[lit-search-mcp] transport error: ${error.stack || error.message}`);
};
transport.onclose = () => {
  console.error('[lit-search-mcp] transport closed');
};

await server.connect(transport);
