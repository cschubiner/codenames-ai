# CLAUDE.md - Project Context for Claude Code

## Project Overview

Codenames AI is a Jackbox-style multiplayer implementation of the Codenames board game with AI integration. Players can join via room codes on their devices while a host screen displays the game board.

## Architecture

### Frontend (`/docs/`)
- **Stack**: Preact + HTM loaded via ESM (no build step)
- **Hosting**: GitHub Pages
- **Key Files**:
  - `index.html` - Entry point
  - `app.js` - Main application logic (Home, Setup, Join, Game, HostView components)
  - `styles.css` - All styling including animations

### Backend (`/worker/`)
- **Stack**: Cloudflare Workers + Durable Objects + Hono router
- **Key Files**:
  - `src/index.ts` - API routes
  - `src/game.ts` - GameRoom Durable Object (game state management)
  - `src/ai.ts` - OpenAI API integration for clue/guess generation
  - `src/types.ts` - TypeScript interfaces

### Shared (`/shared/`)
- `wordlist.json` - Official Codenames 400 word list
- `configs/` - Agent configuration presets
- `schemas/` - JSON schemas for AI structured outputs
- `prompts/` - Prompt templates

## API Endpoints

All endpoints are under `/api/games`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create new game |
| GET | `/:code` | Get game state |
| POST | `/:code/configure` | Set role config (Human/AI) |
| POST | `/:code/join` | Join a role |
| POST | `/:code/start` | Start game |
| POST | `/:code/clue` | Submit human clue |
| POST | `/:code/guess` | Submit guess |
| POST | `/:code/end-turn` | End turn early |
| POST | `/:code/ai-clue` | Generate/confirm AI clue |
| POST | `/:code/ai-suggest` | Get AI guess suggestions |
| POST | `/:code/ai-play` | AI makes a guess |

## Role Configuration

Each of 4 roles can be Human or AI:
- Red Spymaster
- Red Guesser
- Blue Spymaster
- Blue Guesser

When a role is AI, the frontend auto-triggers actions via useEffect hooks.

## Development

### Local Development

```bash
# Terminal 1: Worker (API)
cd worker
npm install
npm run dev  # Runs on http://localhost:8788

# Terminal 2: Frontend
cd docs
python3 -m http.server 3000  # Or any static server
# Open http://localhost:3000
```

### Environment Variables

Worker needs `OPENAI_API_KEY`. For local dev, create `worker/.dev.vars`:
```
OPENAI_API_KEY=sk-...
```

For production, set via Wrangler:
```bash
npx wrangler secret put OPENAI_API_KEY
```

## Deployment

### Deploy Worker to Cloudflare

```bash
cd worker
npx wrangler deploy
```

Note the deployed URL (e.g., `https://codenames-ai.<account>.workers.dev`)

### Deploy Frontend to GitHub Pages

1. Update `docs/app.js` API_BASE to production Worker URL
2. Ensure GitHub Pages is enabled for the `/docs` folder
3. Push to main branch

### Production API URL

The production Worker is at: `https://codenames-ai.cschubiner.workers.dev`

In `docs/app.js`:
```javascript
const API_BASE = window.CODENAMES_API_URL || 'https://codenames-ai.cschubiner.workers.dev';
```

## Game Flow

1. **Host creates game** → Gets 4-letter room code
2. **Host configures roles** → Sets each role to Human or AI
3. **Players join** → Enter room code, select available human role
4. **Game starts** → When all human roles filled
5. **Gameplay**:
   - Spymaster gives clue (word + number)
   - Guessers tap words to guess
   - Turn ends on wrong guess or "End Turn"
   - Teams alternate until win/loss

## AI Integration

### Clue Generation (Spymaster)
- Uses GPT-4o with structured outputs
- Returns: clue word, number, intended targets, reasoning, risk assessment
- Two-step flow: generate → confirm

### Guess Suggestions (Guesser)
- Uses GPT-4o-mini with structured outputs
- Returns: ordered suggestions with confidence scores
- Validates suggestions against unrevealed words

## Common Issues

### "AI suggested invalid word"
Fixed by iterating through suggestions to find first valid unrevealed word.

### Worker not starting
Check if port 8787/8788 is in use. Configure in `wrangler.toml`:
```toml
[dev]
port = 8788
```

### CORS errors
Worker includes CORS headers in `jsonResponse()` function.

## File Structure

```
codenames-ai/
├── CLAUDE.md              # This file
├── README.md              # Project documentation
├── docs/                  # Frontend (GitHub Pages)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── worker/                # Backend (Cloudflare Workers)
│   ├── src/
│   │   ├── index.ts       # Routes
│   │   ├── game.ts        # Durable Object
│   │   ├── ai.ts          # OpenAI integration
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml
│   ├── package.json
│   └── .dev.vars          # Local secrets (gitignored)
├── shared/
│   ├── wordlist.json
│   ├── configs/
│   ├── schemas/
│   └── prompts/
└── python/                # Benchmarking harness (future)
```

## Key Implementation Details

### Auto-triggering AI Actions
Both `Game` and `HostView` components have useEffect hooks that:
1. Check if current team's role is AI
2. If spymaster is AI and no clue → generate and confirm clue
3. If guesser is AI and clue exists → make AI guess

### State Polling
Frontend polls `/api/games/:code` every 2 seconds to sync state.

### Durable Object Persistence
Game state persists in Cloudflare Durable Object storage via `this.state.storage`.

## Repo Hygiene (Important)

- Do **not** delete, restore, reset, or “clean up” unrelated files (including untracked/local-only files created by the user).
- Avoid broad git commands like `git restore .`, `git reset --hard`, or `git clean -fd`.
- Prefer targeted staging (`git add <files>` / `git add -p`) and leave other working tree changes untouched.
