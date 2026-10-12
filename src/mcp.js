// MCP server (stdio) exposing the read-only iCorsi API to AI clients.
// stdout is the MCP channel: never console.log here, only console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ICorsi } from './client.js';
import { registerTools } from './mcp/tools.js';

const server = new McpServer({ name: 'icorsi', version: '0.2.0' });
registerTools(server, new ICorsi());
await server.connect(new StdioServerTransport());
console.error('[icorsi] MCP server ready');
