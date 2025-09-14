# How to Make MCP Server Compatible with ChatGPT Developer Mode

This guide shows how we successfully converted an existing MCP server to work with ChatGPT's Developer Mode MCP integration.

## The Challenge

The original TMDB MCP server worked locally but wouldn't connect with ChatGPT Developer Mode, which requires specific patterns and tools for compatibility.

## The Solution

### 1. Use the Correct MCP Server Class

**❌ Old approach (doesn't work with ChatGPT):**
```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'mcp-server-tmdb',
  version: '1.0.0',
}, {
  capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Tool definitions
});
```

**✅ Correct approach (works with ChatGPT):**
```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({
  name: 'mcp-server-tmdb',
  version: '1.0.0',
});

server.tool('search', 'Description', schema, handler);
```

### 2. Use Proper Tool Registration

**❌ Old approach:**
```javascript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // Manual switch statement handling
});
```

**✅ Correct approach:**
```javascript
server.tool('search', 'Search for movies using TMDB', {
  query: z.string().describe('Search query for movies'),
}, async ({ query }) => {
  // Tool implementation
  return {
    content: [{ type: 'text', text: JSON.stringify(results) }]
  };
});
```

### 3. Implement Proper SSE Transport Connection

**❌ Old approach:**
```javascript
const transport = new SSEServerTransport('/messages', server);
app.get('/sse', async (req, res) => {
  return transport.handleSSEConnection(req, res);
});
```

**✅ Correct approach:**
```javascript
app.get('/sse', async (req, res) => {
  try {
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;
    
    res.on("close", () => {
      delete transports[transport.sessionId];
    });
    
    const server = getServer();
    await server.connect(transport);
  } catch (error) {
    console.error('SSE connection error:', error);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});
```

### 4. Use Only Required Tools

ChatGPT Developer Mode requires exactly these two tools:

- **`search`** - For searching content
- **`fetch`** - For fetching detailed information

**❌ Don't use:** `search_movies`, `get_recommendations`, `get_trending`
**✅ Use:** `search`, `fetch`

### 5. Handle Messages Endpoint Correctly

```javascript
app.post("/messages", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];
    
    if (transport && transport instanceof SSEServerTransport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send('No transport found for sessionId');
    }
  } catch (error) {
    console.error('Messages error:', error);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});
```

## Required Dependencies

Add to your `package.json`:
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.3",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "node-fetch": "^3.3.2",
    "zod": "^3.23.8"
  },
  "type": "module"
}
```

## Deployment Configuration

### Railway deployment (`railway.toml`):
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run start:chatgpt"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

### Package script:
```json
{
  "scripts": {
    "start:chatgpt": "node server-http.js"
  }
}
```

## Complete Working Server Structure

```javascript
#!/usr/bin/env node

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const app = express();
app.use(cors());
app.use(express.json());

const transports = {};

const getServer = () => {
  const server = new McpServer({
    name: 'mcp-server-tmdb',
    version: '1.0.0',
  });

  server.tool('search', 'Search description', {
    query: z.string().describe('Search query'),
  }, async ({ query }) => {
    // Implementation
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  });

  server.tool('fetch', 'Fetch description', {
    id: z.string().describe('ID to fetch'),
  }, async ({ id }) => {
    // Implementation
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  });

  return server;
};

app.get('/sse', async (req, res) => {
  try {
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;
    res.on("close", () => delete transports[transport.sessionId]);
    await getServer().connect(transport);
  } catch (error) {
    console.error('SSE error:', error);
    if (!res.headersSent) res.status(500).end();
  }
});

app.post("/messages", async (req, res) => {
  try {
    const transport = transports[req.query.sessionId];
    if (transport instanceof SSEServerTransport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send('No transport found');
    }
  } catch (error) {
    console.error('Messages error:', error);
    if (!res.headersSent) res.status(500).end();
  }
});

app.listen(process.env.PORT || 3000);
```

## Key Success Factors

1. **Use `McpServer` class** - The newer MCP server implementation
2. **Use `server.tool()` method** - For proper tool registration
3. **Use `await server.connect(transport)`** - For proper transport connection
4. **Follow exact SSE pattern** - From official SDK examples
5. **Add error handling** - To prevent server crashes
6. **Use correct tool names** - `search` and `fetch` only
7. **Remove Dockerfile** - Let nixpacks handle deployment

This pattern ensures your MCP server will work reliably with ChatGPT Developer Mode!