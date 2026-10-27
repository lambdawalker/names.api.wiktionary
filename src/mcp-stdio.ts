#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createWiktionaryMcpServer } from './mcp.js';

try {
  const userAgent = process.env.WIKTIONARY_USER_AGENT;
  if (!userAgent?.trim() || /[\r\n]/u.test(userAgent)) throw new Error('configuration');
  const server = createWiktionaryMcpServer({ clientOptions: { userAgent } });
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write('Wiktionary MCP startup failed. Set WIKTIONARY_USER_AGENT to an informative agent and contact URL.\n');
  process.exitCode = 1;
}
