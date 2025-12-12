# CLAUDE.md - Development Guide for Codenames AI

This file provides context for Claude Code when working on this project.

## Project Overview

Codenames AI is a two-part system:
1. **Python Benchmarking Harness** (`codenames_bench/`) - Tests LLM configurations
2. **Interactive Web Game** (`worker/` + `docs/`) - Multiplayer game with AI spymasters

## Quick Start

### Local Development

```bash
# Start the Worker (backend)
cd worker
npm install
npx wrangler dev --port 8787

# Serve the frontend (in another terminal)
cd docs
python3 -m http.server 5173
# Or use any static file server
```

### API Key Setup

Create `worker/.dev.vars`:
```
OPENAI_API_KEY=your-key-here
```

For production, set the secret via Wrangler:
```bash
npx wrangler secret put OPENAI_API_KEY
```

## Architecture

### Backend (Cloudflare Workers)

- `worker/src/index.ts` - Request routing and CORS
- `worker/src/game.ts` - Durable Object game room logic
- `worker/src/ai.ts` - AI spymaster/guesser integration
- `worker/src/openai.ts` - OpenAI Chat Completions API wrapper
- `worker/src/schemas.ts` - JSON Schema definitions for structured outputs
- `worker/src/presets.ts` - Agent configuration presets

### Frontend (Static Site)

- `docs/index.html` - Main HTML structure
- `docs/styles.css` - Styling (redesigned for better UX)
- `docs/app.js` - Game logic and API interaction
- `docs/config.js` - API endpoint configuration

### Python Benchmarking

- `codenames_bench/` - Main benchmark module
- `configs/` - Agent configuration files
- `scripts/` - Benchmark runner scripts

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/presets` | GET | List available AI agent presets |
| `/api/rooms` | POST | Create a new game room |
| `/api/rooms/:id/join` | POST | Join a room |
| `/api/rooms/:id/state` | GET | Get current game state |
| `/api/rooms/:id/guess` | POST | Make a guess |
| `/api/rooms/:id/stop` | POST | End guessing turn |
| `/api/rooms/:id/ai_guess` | POST | Get AI guess suggestions |
| `/api/rooms/:id/ai_play_next` | POST | Let AI make next guess |
| `/api/rooms/:id/reset` | POST | Reset game board |

## Deployment

### Deploy Worker to Cloudflare

```bash
cd worker
npx wrangler deploy
```

This deploys to your Cloudflare account. Make sure you have:
1. A Cloudflare account
2. `wrangler` authenticated (`npx wrangler login`)
3. The OPENAI_API_KEY secret set (`npx wrangler secret put OPENAI_API_KEY`)

### Deploy Frontend to GitHub Pages

1. Update `docs/config.js` to point to your production Worker URL:
   ```javascript
   window.CODENAMES_API_BASE = "https://codenames-ai.your-subdomain.workers.dev";
   ```

2. Enable GitHub Pages in repository settings:
   - Go to Settings > Pages
   - Source: Deploy from branch
   - Branch: main, folder: /docs

3. Push to GitHub - Pages auto-deploys

## Key Technical Details

### OpenAI Integration

Uses **Chat Completions API** with **Structured Outputs** (JSON Schema):
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Response format: `json_schema` with `strict: true`

**Important**: OpenAI strict mode requires ALL properties in the `required` array.

### Game Flow

1. Room created with AI agent presets for RED and BLUE spymasters
2. Players join teams via room code
3. AI generates clue when turn starts (status: "thinking" -> "ready")
4. Players guess words or use AI assistance
5. Turn ends on wrong guess, pass, or all guesses used
6. Game ends when team finds all words or assassin revealed

### Durable Objects

Game state stored in Cloudflare Durable Objects:
- One instance per room (keyed by room ID)
- Handles concurrent requests with built-in synchronization
- State persisted across requests

## Common Issues & Fixes

### Schema Validation Errors

If you see `Missing 'property_name' in required` errors:
- OpenAI strict JSON schema requires ALL properties in `required`
- Check `worker/src/schemas.ts` and `codenames_bench/schemas.py`

### CORS Errors

- Worker handles CORS via `worker/src/cors.ts`
- Preflight OPTIONS requests return proper headers
- Ensure `Access-Control-Allow-Origin` matches your frontend domain

### API Key Not Working

- Local: Check `.dev.vars` exists and has correct key
- Production: Run `npx wrangler secret put OPENAI_API_KEY`

## Testing

### Test Full Game via Script

```bash
bash /tmp/play_to_end.sh
```

This creates a room, joins players, and plays to completion via API calls.

### Run Python Benchmark

```bash
cd codenames_bench
python -m scripts.run_benchmark --games 5
```

## Development Workflow

1. Make changes to worker code
2. Test locally with `npx wrangler dev`
3. Run API tests to verify functionality
4. Deploy with `npx wrangler deploy`
5. Update frontend if needed
6. Push to GitHub for Pages deployment

## Environment Variables

| Variable | Location | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | `.dev.vars` / Wrangler secret | OpenAI API key |

## File Modification Checklist

When modifying schemas:
- [ ] Update `worker/src/schemas.ts`
- [ ] Update `codenames_bench/schemas.py`
- [ ] Ensure all properties are in `required` array
- [ ] Test with full game simulation

When modifying API:
- [ ] Update route in `worker/src/index.ts`
- [ ] Update handler in `worker/src/game.ts`
- [ ] Update frontend in `docs/app.js`
- [ ] Test endpoints manually or with script
