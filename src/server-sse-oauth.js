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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'mcp-session-id', 'Cache-Control']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth storage
const tokens = new Map();

// OAuth metadata endpoint
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
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

// OAuth authorize endpoint
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, scope, state, response_type } = req.query;
  
  console.log('ChatGPT OAuth authorize:', { client_id, redirect_uri, scope, state, response_type });
  
  const code = randomUUID();
  tokens.set(code, {
    client_id: client_id || 'default',
    scope: scope || 'read',
    created_at: Date.now()
  });
  
  const callback = new URL(redirect_uri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  
  console.log('Generated code:', code);
  console.log('Redirecting to:', callback.toString());
  res.redirect(callback.toString());
});

// OAuth token endpoint
app.post('/oauth/token', (req, res) => {
  const { grant_type, code, client_id } = req.body;
  
  console.log('ChatGPT token request:', { grant_type, code, client_id });
  
  if (grant_type !== 'authorization_code') {
    console.log('Unsupported grant type:', grant_type);
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  
  const tokenData = tokens.get(code);
  if (!tokenData) {
    console.log('Invalid code:', code);
    return res.status(400).json({ error: 'invalid_grant' });
  }
  
  const accessToken = randomUUID();
  tokens.set(accessToken, {
    type: 'access_token',
    client_id: tokenData.client_id,
    scope: tokenData.scope,
    created_at: Date.now()
  });
  
  tokens.delete(code);
  console.log('Generated access token:', accessToken);
  
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: tokenData.scope
  });
});

// Auth middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    console.log('Missing or invalid authorization header');
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  const token = auth.slice(7);
  const tokenData = tokens.get(token);
  
  if (!tokenData || tokenData.type !== 'access_token') {
    console.log('Invalid access token:', token);
    return res.status(401).json({ error: 'invalid_token' });
  }
  
  console.log('Valid token for client:', tokenData.client_id);
  next();
}

// MCP Server setup
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

// Only search and fetch tools as required by ChatGPT
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search',
        description: 'Search for movies by title or keywords using TMDB. Returns a list of movie results with IDs, titles, and URLs.',
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
        description: 'Fetch detailed movie information by TMDB movie ID. Returns complete movie details including plot, cast, and metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'TMDB movie ID',
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
    throw new Error('TMDB_API_KEY environment variable is required');
  }

  try {
    switch (name) {
      case 'search': {
        console.log('TMDB search for:', args.query);
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
        console.log('TMDB fetch for ID:', args.id);
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${args.id}?api_key=${apiKey}&append_to_response=credits,reviews`
        );
        const data = await response.json();
        
        const document = {
          id: data.id?.toString() || args.id,
          title: `${data.title} (${data.release_date?.split('-')[0] || 'Unknown'})`,
          text: `Title: ${data.title}
Release Date: ${data.release_date}
Rating: ${data.vote_average}/10
Overview: ${data.overview}
Genres: ${data.genres?.map(g => g.name).join(', ') || 'Unknown'}
Runtime: ${data.runtime} minutes
Director: ${data.credits?.crew?.find(person => person.job === 'Director')?.name || 'Unknown'}
Cast: ${data.credits?.cast?.slice(0, 5).map(actor => actor.name).join(', ') || 'Unknown'}`,
          url: `https://www.themoviedb.org/movie/${data.id}`,
          metadata: {
            budget: data.budget,
            revenue: data.revenue,
            popularity: data.popularity
          }
        };
        
        return { content: [{ type: 'text', text: JSON.stringify(document) }] };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error('Tool execution error:', error);
    throw new Error(`Tool execution failed: ${error.message}`);
  }
});

// SSE endpoint with optional authentication for testing
app.get('/sse', async (req, res) => {
  console.log('SSE connection request from:', req.headers['user-agent']);
  console.log('Authorization header:', req.headers.authorization ? 'Present' : 'Missing');
  
  // Check for auth but don't require it for initial connection test
  if (req.headers.authorization) {
    const auth = req.headers.authorization;
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const tokenData = tokens.get(token);
      
      if (!tokenData || tokenData.type !== 'access_token') {
        console.log('Invalid access token:', token);
        return res.status(401).json({ error: 'invalid_token' });
      }
      console.log('Valid token for client:', tokenData.client_id);
    }
  } else {
    console.log('No authorization header - allowing connection test');
  }
  
  // Create SSE transport for this connection
  const transport = new SSEServerTransport('/sse', server);
  await transport.handleSSEConnection(req, res);
});

// Also support /messages for compatibility
app.post('/messages', requireAuth, async (req, res) => {
  console.log('Messages POST request');
  
  const transport = new SSEServerTransport('/sse', server);
  await transport.handlePostRequest(req, res);
});

// Status endpoint
app.get('/', (req, res) => {
  res.json({ 
    name: 'TMDB MCP Server - SSE with OAuth',
    version: '1.0.0',
    status: 'running',
    transport: 'sse',
    auth: 'oauth2',
    endpoints: {
      sse: '/sse',
      messages: '/messages',
      oauth_authorize: '/oauth/authorize',
      oauth_token: '/oauth/token'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TMDB MCP Server - SSE with OAuth running on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});
