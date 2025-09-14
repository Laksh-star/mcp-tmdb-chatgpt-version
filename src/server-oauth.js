#!/usr/bin/env node

import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'mcp-session-id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth state storage (in production, use a proper database)
const authorizationCodes = new Map();
const accessTokens = new Map();
const clients = new Map();

// Default client for dynamic registration
const DEFAULT_CLIENT = {
  client_id: 'tmdb-mcp-client',
  client_secret: crypto.randomUUID(),
  redirect_uris: [
    'https://chatgpt.com/oauth/callback', 
    'https://chat.openai.com/oauth/callback',
    'https://platform.openai.com/oauth/callback',
    'http://localhost:3000/oauth/callback'
  ],
  scope: 'tmdb:read'
};

clients.set(DEFAULT_CLIENT.client_id, DEFAULT_CLIENT);

// OAuth Authorization Server Metadata (RFC8414)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    scopes_supported: ['tmdb:read'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
  });
});

// OAuth Protected Resource Metadata
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['tmdb:read'],
    bearer_methods_supported: ['header']
  });
});

// Dynamic Client Registration (RFC7591)
app.post('/oauth/register', (req, res) => {
  const { redirect_uris, scope = 'tmdb:read' } = req.body;
  
  const client = {
    client_id: crypto.randomUUID(),
    client_secret: crypto.randomUUID(),
    redirect_uris: redirect_uris || DEFAULT_CLIENT.redirect_uris,
    scope
  };
  
  clients.set(client.client_id, client);
  
  res.json({
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uris: client.redirect_uris,
    scope: client.scope
  });
});

// OAuth Authorization Endpoint
app.get('/oauth/authorize', (req, res) => {
  const { 
    client_id, 
    redirect_uri, 
    scope = 'tmdb:read', 
    state, 
    response_type = 'code',
    code_challenge,
    code_challenge_method = 'S256'
  } = req.query;

  console.log('OAuth authorize request:', { client_id, redirect_uri, scope, state });

  // For ChatGPT, be more lenient with client validation
  const client = clients.get(client_id) || clients.get(DEFAULT_CLIENT.client_id);
  if (!client) {
    console.log('No valid client found, using default');
  }

  // Generate authorization code
  const authCode = crypto.randomUUID();
  authorizationCodes.set(authCode, {
    client_id: client_id || DEFAULT_CLIENT.client_id,
    redirect_uri,
    scope,
    code_challenge,
    code_challenge_method,
    expires_at: Date.now() + 600000 // 10 minutes
  });

  console.log('Generated auth code:', authCode);

  // Auto-approve for ChatGPT integration
  try {
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', authCode);
    if (state) callbackUrl.searchParams.set('state', state);
    
    console.log('Redirecting to:', callbackUrl.toString());
    res.redirect(callbackUrl.toString());
  } catch (error) {
    console.error('Redirect error:', error);
    res.status(400).json({ error: 'invalid_redirect_uri', details: error.message });
  }
});

// OAuth Token Endpoint
app.post('/oauth/token', (req, res) => {
  const { 
    grant_type, 
    code, 
    redirect_uri, 
    client_id, 
    client_secret,
    code_verifier 
  } = req.body;

  console.log('OAuth token request:', { grant_type, code, client_id, redirect_uri });

  if (grant_type === 'client_credentials') {
    // Client credentials flow - be more lenient for ChatGPT
    const client = clients.get(client_id) || clients.get(DEFAULT_CLIENT.client_id);
    
    const accessToken = crypto.randomUUID();
    accessTokens.set(accessToken, {
      client_id: client_id || DEFAULT_CLIENT.client_id,
      scope: 'tmdb:read',
      expires_at: Date.now() + 3600000 // 1 hour
    });

    console.log('Generated access token for client credentials:', accessToken);
    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'tmdb:read'
    });
  }

  if (grant_type === 'authorization_code') {
    const authData = authorizationCodes.get(code);
    console.log('Looking for auth code:', code, 'Found:', !!authData);
    
    if (!authData || authData.expires_at < Date.now()) {
      console.log('Invalid or expired auth code');
      return res.status(400).json({ error: 'invalid_grant', details: 'Code not found or expired' });
    }

    // Verify PKCE if used
    if (authData.code_challenge && code_verifier) {
      const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
      if (hash !== authData.code_challenge) {
        console.log('PKCE verification failed');
        return res.status(400).json({ error: 'invalid_grant', details: 'PKCE verification failed' });
      }
    }

    authorizationCodes.delete(code);

    const accessToken = crypto.randomUUID();
    accessTokens.set(accessToken, {
      client_id: authData.client_id,
      scope: authData.scope,
      expires_at: Date.now() + 3600000 // 1 hour
    });

    console.log('Generated access token for auth code:', accessToken);
    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: authData.scope
    });
  }

  console.log('Unsupported grant type:', grant_type);
  res.status(400).json({ error: 'unsupported_grant_type' });
});

// OAuth middleware for MCP endpoints
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const token = authHeader.slice(7);
  const tokenData = accessTokens.get(token);
  
  if (!tokenData || tokenData.expires_at < Date.now()) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  req.tokenData = tokenData;
  next();
}

// Map to store transports by session ID
const transports = {};

// Create MCP Server
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

// Required tools for ChatGPT
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search',
        description: 'Search for movies by title or keywords using TMDB',
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
        description: 'Fetch detailed information about a specific movie by ID',
        inputSchema: {
          type: 'object',
          properties: {
            movieId: {
              type: 'string',
              description: 'TMDB movie ID to fetch details for',
            },
          },
          required: ['movieId'],
        },
      },
      {
        name: 'get_recommendations',
        description: 'Get movie recommendations based on a movie ID',
        inputSchema: {
          type: 'object',
          properties: {
            movieId: {
              type: 'string',
              description: 'TMDB movie ID',
            },
          },
          required: ['movieId'],
        },
      },
      {
        name: 'get_trending',
        description: 'Get trending movies for a specified time window',
        inputSchema: {
          type: 'object',
          properties: {
            timeWindow: {
              type: 'string',
              description: 'Time window: "day" or "week"',
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

// Handle POST requests for client-to-server communication (with OAuth)
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

// Handle GET requests for server-to-client streaming (with OAuth)
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
    name: 'TMDB MCP Server with OAuth',
    version: '1.0.0',
    status: 'running',
    transport: 'streamable-http',
    auth: 'oauth2.1',
    endpoints: {
      mcp: '/mcp',
      oauth_authorize: '/oauth/authorize',
      oauth_token: '/oauth/token',
      oauth_register: '/oauth/register'
    },
    client_info: {
      client_id: DEFAULT_CLIENT.client_id,
      redirect_uris: DEFAULT_CLIENT.redirect_uris
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TMDB MCP Server with OAuth running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`OAuth endpoints: /oauth/authorize, /oauth/token`);
  console.log(`Default client_id: ${DEFAULT_CLIENT.client_id}`);
});
