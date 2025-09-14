#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

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
    throw new Error('TMDB_API_KEY environment variable is required');
  }

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
            popularity: data.popularity
          }
        };
        
        return { content: [{ type: 'text', text: JSON.stringify(document) }] };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    throw new Error(`Tool execution failed: ${error.message}`);
  }
});

// Create SSE transport
const transport = new SSEServerTransport('/messages', server);

// Set up routes
app.get('/sse', async (req, res) => {
  return transport.handleSSEConnection(req, res);
});

app.post('/messages', async (req, res) => {
  return transport.handlePostRequest(req, res);
});

app.get('/', (req, res) => {
  res.json({ 
    name: 'TMDB MCP Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      sse: '/sse',
      messages: '/messages'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TMDB MCP Server running on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Messages endpoint: http://localhost:${PORT}/messages`);
});
