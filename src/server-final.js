#!/usr/bin/env node

import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage for OAuth tokens
const tokens = new Map();

// Create the MCP server
const server = new Server(
  {
    name: 'tmdb-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Configure MCP server with only search and fetch tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search',
        description: 'Search for movies by title or keywords',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for movies',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'fetch',
        description: 'Fetch detailed movie information by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Movie ID to fetch',
            },
          },
          required: ['id'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const apiKey = process.env.TMDB_API_KEY;
  
  if (!apiKey) {
    throw new Error('TMDB_API_KEY required');
  }

  console.log(`Tool called: ${name}`, args);

  try {
    switch (name) {
      case 'search': {
        const response = await fetch(
          `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(args.query)}`
        );
        const data = await response.json();
        
        const results = {
          results: data.results?.slice(0, 10).map(movie => ({
            id: movie.id.toString(),
            title: `${movie.title} (${movie.release_date?.split('-')[0] || 'Unknown'})`,
            url: `https://www.themoviedb.org/movie/${movie.id}`
          })) || []
        };
        
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }
      
      case 'fetch': {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${args.id}?api_key=${apiKey}&append_to_response=credits`
        );
        const data = await response.json();
        
        const document = {
          id: data.id?.toString() || args.id,
          title: `${data.title} (${data.release_date?.split('-')[0] || 'Unknown'})`,
          text: `${data.title}\n\nRelease Date: ${data.release_date}\nRating: ${data.vote_average}/10\n\nOverview: ${data.overview}\n\nGenres: ${data.genres?.map(g => g.name).join(', ')}\nRuntime: ${data.runtime} minutes\nDirector: ${data.credits?.crew?.find(p => p.job === 'Director')?.name}\nMain Cast: ${data.credits?.cast?.slice(0, 5).map(a => a.name).join(', ')}`,
          url: `https://www.themoviedb.org/movie/${data.id}`,
          metadata: {
            tmdb_id: data.id,
            popularity: data.popularity,
            budget: data.budget,
            revenue: data.revenue
          }
        };
        
        return { content: [{ type: 'text', text: JSON.stringify(document) }] };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error('Tool error:', error);
    throw new Error(`Tool failed: ${error.message}`);
  }
});

// Create SSE transport
const transport = new SSEServerTransport('/sse', server);

// OAuth endpoints
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  console.log('OAuth discovery request');
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    scopes_supported: ['read'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none']
  });
});

app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, scope, state } = req.query;
  console.log('OAuth authorize:', { client_id, redirect_uri, scope, state });
  
  const code = randomUUID();
  tokens.set(code, {
    client_id: client_id || 'chatgpt',
    scope: scope || 'read',
    created_at: Date.now()
  });
  
  const callback = new URL(redirect_uri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  
  console.log('Redirecting with code:', code);
  res.redirect(callback.toString());
});

app.post('/oauth/token', (req, res) => {
  const { grant_type, code } = req.body;
  console.log('Token request:', { grant_type, code });
  
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  
  const authData = tokens.get(code);
  if (!authData) {
    console.log('Invalid code');
    return res.status(400).json({ error: 'invalid_grant' });
  }
  
  const accessToken = randomUUID();
  tokens.set(accessToken, {
    type: 'access_token',
    client_id: authData.client_id,
    scope: authData.scope,
    created_at: Date.now()
  });
  
  tokens.delete(code);
  console.log('Issued token:', accessToken);
  
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: authData.scope
  });
});

// Simple auth check
function checkAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return false;
  }
  
  const token = auth.slice(7);
  const tokenData = tokens.get(token);
  return tokenData && tokenData.type === 'access_token';
}

// SSE endpoint
app.get('/sse', async (req, res) => {
  console.log('SSE connection from:', req.headers['user-agent']);
  
  if (!checkAuth(req)) {
    console.log('No valid auth for SSE');
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  console.log('Authorized SSE connection');
  await transport.handleSSEConnection(req, res);
});

// Messages endpoint
app.post('/messages', async (req, res) => {
  console.log('Messages request');
  
  if (!checkAuth(req)) {
    console.log('No valid auth for messages');
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  console.log('Authorized messages request');
  await transport.handlePostRequest(req, res);
});

// Root status
app.get('/', (req, res) => {
  res.json({
    name: 'TMDB MCP Server',
    version: '1.0.0',
    status: 'running',
    transport: 'sse',
    endpoints: {
      sse: '/sse',
      messages: '/messages'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TMDB MCP Server running on port ${PORT}`);
  console.log(`Ready for ChatGPT connections`);
});