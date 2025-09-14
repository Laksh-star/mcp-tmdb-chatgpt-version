# TMDB MCP Server for ChatGPT

This MCP server integrates with The Movie Database (TMDB) API to provide movie information, search capabilities, and recommendations. Now with **ChatGPT Developer Mode support**!

## 🚀 Quick Deploy to ChatGPT

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new?template=https%3A%2F%2Fgithub.com%2FLaksh-star%2Fmcp-server-tmdb&envs=TMDB_API_KEY&TMDB_API_KEYDesc=Your+TMDB+API+key+from+themoviedb.org)

**One-click deployment for ChatGPT Developer Mode integration**

## Prerequisites

Before installing and running the TMDB MCP server, ensure you have the following prerequisites installed and configured:

### Required software

- **Node.js**
  - Version 18.0.0 or higher
  - Download from [Node.js official website](https://nodejs.org/)
  - Verify installation: `node --version`

- **npm (Node Package Manager)**
  - Version 8.0.0 or higher (comes with Node.js)
  - Verify installation: `npm --version`

- **TypeScript**
  - Will be installed as a project dependency
  - Can be installed globally: `npm install -g typescript`
  - Verify installation: `tsc --version`

### Required accounts & API keys

- **TMDB account**
  - Free account at [TMDB](https://www.themoviedb.org/)
  - API key from TMDB dashboard
  - API access must be approved by TMDB

- **Claude desktop application**
  - Latest version installed
  - Access to modify configuration files

### System requirements

- **Operating systems**
  - macOS (10.15 or later)
  - Linux (modern distributions)

- **Hardware requirements**
- Minimum 4GB RAM
  - 1GB free disk space
  - Stable internet connection

### Development environment

For the best development experience, we recommend:
- A code editor with TypeScript support (e.g., VS Code)
- Terminal access
- Git (for version control)

## Features

### Tools

- **search_movies**
  - Search for movies by title or keywords
  - Input: `query` (string): Search query
  - Returns: List of movies with titles, release years, IDs, ratings, and overviews
  - Example: Search for movies about space exploration

- **get_recommendations**
  - Get movie recommendations based on a movie ID
  - Input: `movieId` (string): TMDB movie ID
  - Returns: Top 5 recommended movies with details
  - Example: Get recommendations based on movie ID 550 (Fight Club)

- **get_trending**
  - Get trending movies for a specified time window
  - Input: `timeWindow` (string): Either "day" or "week"
  - Returns: Top 10 trending movies with details
  - Example: Get today's trending movies

### Resources

The server provides access to TMDB movie information:

- **Movies** (`tmdb:///movie/<movie_id>`)
  - Comprehensive movie details including:
    - Title and release date
    - Rating and overview
    - Genres
    - Poster URL
    - Cast information (top 5 actors)
    - Director
    - Selected reviews
  - All data is returned in JSON format

## Getting started

1. Get a TMDB API key:
   - Sign up at [TMDB](https://www.themoviedb.org/)
   - Go to your account settings
   - Navigate to the API section
   - Request an API key for developer use

2. Clone and set up the project:
   ```bash
   git clone [repository-url]
   cd mcp-server-tmdb
   npm install
   ```

3. Build the server:
   ```bash
   npm run build
   ```

4. Set up your environment variable:
   ```bash
   export TMDB_API_KEY=your_api_key_here
   ```

## ChatGPT Developer Mode Integration

This server now supports **ChatGPT Developer Mode** with a dedicated MCP implementation:

### Quick Setup for ChatGPT

#### Deployment Steps
1. **Deploy to Railway (or similar platform)**:
   - Set `TMDB_API_KEY` environment variable
   - Deploy using the included `railway.toml` configuration
   - Server will run on `npm run start:chatgpt` command

2. **Add to ChatGPT**:
   - Go to ChatGPT Developer Mode settings
   - Add your deployed server URL
   - ChatGPT will connect to the `/sse` endpoint automatically

3. **Available ChatGPT Tools**:
   - **search**: Search for movies by title or keywords
   - **fetch**: Get detailed movie information by TMDB ID

### Run ChatGPT-compatible server locally:
```bash
npm run start:chatgpt
```

The server will start with SSE endpoints at `/sse` and `/messages` for ChatGPT integration.

### Usage with Claude Desktop

To integrate this server with Claude Desktop, add the following to your app's server configuration file (located at `~/Library/Application Support/Claude/config.json`):

```json
{
  "mcpServers": {
    "tmdb": {
      "command": "/full/path/to/dist/index.js",
      "env": {
        "TMDB_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Replace `/full/path/to` with the actual path to your project directory.

### Installing via Smithery

To install TMDB Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@Laksh-star/mcp-server-tmdb):

```bash
npx -y @smithery/cli install @Laksh-star/mcp-server-tmdb --client claude
```

## Example usage

Once the server is running with Claude Desktop, you can use commands like:

1. Search for movies:
   ```
   "Search for movies about artificial intelligence"
   ```

2. Get trending movies:
   ```
   "What are the trending movies today?"
   "Show me this week's trending movies"
   ```

3. Get movie recommendations:
   ```
   "Get movie recommendations based on movie ID 550"
   ```

4. Get movie details:
   ```
   "Tell me about the movie with ID 550"
   ```

### ChatGPT Usage Examples

Once deployed and connected to ChatGPT Developer Mode:

1. **Search movies in ChatGPT**:
   ```
   "Search for sci-fi movies about space"
   "Find movies with Tom Hanks"
   ```

2. **Get detailed movie information**:
   ```
   "Fetch details for movie ID 550"
   "Get information about Blade Runner 2049"
   ```

ChatGPT will automatically use the `search` and `fetch` tools to provide movie information directly in the conversation.

## Error handling

The server includes comprehensive error handling for:
- Invalid API keys
- Network errors
- Invalid movie IDs
- Malformed requests

Error messages will be returned in a user-friendly format through Claude Desktop.

## Development

To watch for changes during development:
```bash
npm run watch
```

### Available Scripts

- `npm run build` - Build the TypeScript project
- `npm run watch` - Watch for changes during development  
- `npm run start:chatgpt` - Run ChatGPT-compatible MCP server
- `npm run prepare` - Build and set executable permissions

For implementation details on ChatGPT integration, see `CHATGPT_INTEGRATION.md`.

## License

This MCP server is licensed under the MIT License. See the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
