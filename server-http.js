#!/usr/bin/env node

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import fetch from 'node-fetch';
import cors from 'cors';
import { z } from 'zod';

const app = express();
app.use(cors());
app.use(express.json());

// Store transports by session ID
const transports = {};

const getServer = () => {
  const server = new McpServer({
    name: 'mcp-server-tmdb',
    version: '1.0.0',
  });

  // Register ChatGPT-required tools
  server.tool('search', 'Search for movies by title or keywords using TMDB', {
    query: z.string().describe('Search query for movies'),
  }, async ({ query }) => {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      throw new Error('TMDB_API_KEY environment variable is required');
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}`
    );
    const data = await response.json();
    
    const results = {
      results: data.results?.slice(0, 10).map(movie => ({
        id: movie.id.toString(),
        title: `${movie.title} (${movie.release_date?.split('-')[0] || 'Unknown'})`,
        url: `https://www.themoviedb.org/movie/${movie.id}`
      })) || []
    };
    
    return {
      content: [{ type: 'text', text: JSON.stringify(results) }]
    };
  });

  server.tool('fetch', 'Fetch detailed movie information by TMDB movie ID', {
    id: z.string().describe('TMDB movie ID'),
  }, async ({ id }) => {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      throw new Error('TMDB_API_KEY environment variable is required');
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}&append_to_response=credits`
    );
    const data = await response.json();
    
    const document = {
      id: data.id?.toString() || id,
      title: `${data.title} (${data.release_date?.split('-')[0] || 'Unknown'})`,
      text: `${data.title}\n\nRelease Date: ${data.release_date}\nRating: ${data.vote_average}/10\n\nOverview: ${data.overview}\n\nGenres: ${data.genres?.map(g => g.name).join(', ')}\nRuntime: ${data.runtime} minutes\nDirector: ${data.credits?.crew?.find(p => p.job === 'Director')?.name}\nMain Cast: ${data.credits?.cast?.slice(0, 5).map(a => a.name).join(', ')}`,
      url: `https://www.themoviedb.org/movie/${data.id}`,
      metadata: {
        tmdb_id: data.id,
        popularity: data.popularity
      }
    };
    
    return {
      content: [{ type: 'text', text: JSON.stringify(document) }]
    };
  });

  return server;
};

// SSE endpoint for ChatGPT
app.get('/sse', async (req, res) => {
  console.log('SSE connection from:', req.headers['user-agent']);
  
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

// Messages endpoint for ChatGPT
app.post("/messages", async (req, res) => {
  console.log('Messages request from:', req.headers['user-agent']);
  
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

// Root status endpoint
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
