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
  allowedHeaders: ['Content-Type', 'Cache-Control', 'Accept']
}));
app.use(express.json());

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

// Configure MCP server with only search and fetch tools (as required by ChatGPT)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log('Tools requested');
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
        description: 'Fetch detailed movie information by TMDB movie ID',
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
        
        // Format as required by ChatGPT MCP spec
        const results = {
          results: data.results?.slice(0, 10).map(movie => ({
            id: movie.id.toString(),
            title: `${movie.title} (${movie.release_date?.split('-')[0] || 'Unknown'})`,
            url: `https://www.themoviedb.org/movie/${movie.id}`
          })) || []
        };
        
        console.log(`Search returned ${results.results.length} results`);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }
      
      case 'fetch': {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${args.id}?api_key=${apiKey}&append_to_response=credits`
        );
        const data = await response.json();
        
        // Format as required by ChatGPT MCP spec
        const document = {
          id: data.id?.toString() || args.id,
          title: `${data.title} (${data.release_date?.split('-')[0] || 'Unknown'})`,
          text: `${data.title}\n\nRelease Date: ${data.release_date}\nRating: ${data.vote_average}/10\n\nOverview: ${data.overview}\n\nGenres: ${data.genres?.map(g => g.name).join(', ')}\nRuntime: ${data.runtime} minutes\nDirector: ${data.credits?.crew?.find(p => p.job === 'Director')?.name}\nMain Cast: ${data.credits?.cast?.slice(0, 5).map(a => a.name).join(', ')}`,
          url: `https://www.themoviedb.org/movie/${data.id}`,
          metadata: {
            tmdb_id: data.id,
            popularity: data.popularity
          }
        };
        
        console.log(`Fetched movie: ${data.title}`);
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

// SSE endpoint (no authentication required)
app.get('/sse', async (req, res) => {
  console.log('SSE connection from:', req.headers['user-agent']);
  await transport.handleRequest(req, res);
});

// Messages endpoint (no authentication required) 
app.post('/messages', async (req, res) => {
  console.log('Messages request');
  await transport.handleRequest(req, res);
});

// Root status
app.get('/', (req, res) => {
  res.json({
    name: 'TMDB MCP Server - No Auth',
    version: '1.0.0',
    status: 'running',
    transport: 'sse',
    authentication: 'none',
    endpoints: {
      sse: '/sse',
      messages: '/messages'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TMDB MCP Server (No Auth) running on port ${PORT}`);
  console.log(`Ready for ChatGPT connections at /sse`);
});
