#!/usr/bin/env node

import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'mcp-session-id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple in-memory storage
const tokens = new Map();

// Minimal OAuth metadata for ChatGPT
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

// Simple OAuth authorize endpoint  
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, scope, state, response_type } = req.query;
  
  console.log('ChatGPT OAuth authorize:', { client_id, redirect_uri, scope, state, response_type });
  
  // Generate authorization code
  const code = randomUUID();
  
  // Store it simply
  tokens.set(code, {
    client_id: client_id || 'default',
    scope: scope || 'read',
    created_at: Date.now()
  });
  
  // Auto-approve and redirect back to ChatGPT
  const callback = new URL(redirect_uri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  
  console.log('Generated code:', code);
  console.log('Redirecting to:', callback.toString());
  res.redirect(callback.toString());
});

// Simple token endpoint
app.post('/oauth/token', (req, res) => {
  const { grant_type, code, client_id } = req.body;
  
  console.log('ChatGPT token request:', { grant_type, code, client_id });
  
  if (grant_type !== 'authorization_code') {
    console.log('Unsupported grant type:', grant_type);
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  
  const tokenData = tokens.get(code);
  if (!tokenData) {
    console.log('Invalid or expired code:', code);
    console.log('Available codes:', Array.from(tokens.keys()));
    return res.status(400).json({ error: 'invalid_grant' });
  }
  
  // Generate access token
  const accessToken = randomUUID();
  tokens.set(accessToken, {
    type: 'access_token',
    client_id: tokenData.client_id,
    scope: tokenData.scope,
    created_at: Date.now()
  });
  
  // Clean up authorization code
  tokens.delete(code);
  
  console.log('Generated access token:', accessToken);
  
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: tokenData.scope
  });
});

// Simple auth middleware
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
const transports = {};
const server = new Server(
  {
    name: 'mcp-server-tmdb',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search',
        description: 'Search for movies by title or keywords using TMDB. Use this when the user asks to find movies, search for films, or look up movies by name. Returns movie titles, IDs, ratings, and overviews.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Movie title, keywords, or search terms to find movies',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'fetch',
        description: 'Get detailed information about a specific movie by its TMDB ID. Use this when you have a movie ID and need complete details like plot, cast, director, genres, runtime, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            movieId: {
              type: 'string',
              description: 'The TMDB movie ID number (from search results or user input)',
            },
          },
          required: ['movieId'],
        },
      },
      {
        name: 'get_recommendations',
        description: 'Get movie recommendations similar to a specific movie. Use this when the user asks for movies similar to or like a particular film they mention.',
        inputSchema: {
          type: 'object',
          properties: {
            movieId: {
              type: 'string',
              description: 'TMDB movie ID to base recommendations on',
            },
          },
          required: ['movieId'],
        },
      },
      {
        name: 'get_trending',
        description: 'Get currently trending/popular movies. Use this when the user asks about popular movies, trending films, what\'s hot now, or current movie trends.',
        inputSchema: {
          type: 'object',
          properties: {
            timeWindow: {
              type: 'string',
              description: 'Time period for trending movies',
              enum: ['day', 'week'],
            },
          },
          required: ['timeWindow'],
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
        const response = await fetch(
          `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(args.query)}`
        );
        const data = await response.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      
      case 'fetch': {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${args.movieId}?api_key=${apiKey}`
        );
        const data = await response.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      
      case 'get_recommendations': {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${args.movieId}/recommendations?api_key=${apiKey}`
        );
        const data = await response.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      
      case 'get_trending': {
        const response = await fetch(
          `https://api.themoviedb.org/3/trending/movie/${args.timeWindow}?api_key=${apiKey}`
        );
        const data = await response.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    throw new Error(`Tool execution failed: ${error.message}`);
  }
});

// Protected MCP endpoints
app.post('/mcp', requireAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || randomUUID();
  
  let transport;
  if (transports[sessionId]) {
    transport = transports[sessionId];
  } else {
    transport = new StreamableHTTPServerTransport(server);
    transports[sessionId] = transport;
  }
  
  res.setHeader('Mcp-Session-Id', sessionId);
  await transport.handlePostRequest(req, res);
});

app.get('/mcp', requireAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || randomUUID();
  
  let transport;
  if (transports[sessionId]) {
    transport = transports[sessionId];
  } else {
    transport = new StreamableHTTPServerTransport(server);
    transports[sessionId] = transport;
  }
  
  res.setHeader('Mcp-Session-Id', sessionId);
  await transport.handleGetRequest(req, res);
});

// Status endpoint
app.get('/', (req, res) => {
  res.json({ 
    name: 'TMDB MCP Server - Simple OAuth',
    version: '1.0.0',
    status: 'running',
    transport: 'streamable-http',
    auth: 'simple-oauth',
    endpoints: {
      mcp: '/mcp',
      oauth_authorize: '/oauth/authorize',
      oauth_token: '/oauth/token'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TMDB MCP Server - Simple OAuth running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
