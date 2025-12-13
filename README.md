# Codenames AI

A Jackbox-style multiplayer Codenames game with AI integration. Host a game on a TV screen, players join via room codes on their phones, and any role can be played by humans or AI.

## Features

- **Jackbox-style Multiplayer**: Host displays board on TV, players join on phones
- **Flexible AI**: Any of the 4 roles (Red/Blue Spymaster/Guesser) can be Human or AI
- **AI Assistance**: Human players can request AI suggestions or let AI play
- **No Account Required**: Just share the 4-letter room code

## Quick Start

### Play Locally

```bash
# Clone the repo
git clone https://github.com/yourusername/codenames-ai.git
cd codenames-ai

# Start the backend
cd worker
npm install
echo "OPENAI_API_KEY=sk-your-key-here" > .dev.vars
npm run dev

# In another terminal, start the frontend
cd docs
python3 -m http.server 3000

# Open http://localhost:3000
```

### Play Online

Visit: https://canal.github.io/codenames-ai/

## How to Play

1. **Host a Game**: Click "Host Game" to create a room
2. **Configure Roles**: Choose Human or AI for each role
3. **Share Room Code**: Other players enter the 4-letter code to join
4. **Start Game**: Once all human roles are filled, click "Start Game"
5. **Play!**
   - **Spymasters** give one-word clues with a number
   - **Guessers** tap words on the board to guess
   - First team to find all their words wins
   - Hit the assassin = instant loss!

## Game Configurations

| Setup | Description |
|-------|-------------|
| All Human | Classic party game |
| AI Spymasters | Test your guessing against AI clues |
| AI Guessers | See if your clues work on AI |
| Human vs AI Team | Compete against full AI team |
| All AI | Demo/spectator mode |

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│  GitHub Pages   │────▶│  Cloudflare Worker   │
│   (Frontend)    │◀────│  + Durable Objects   │
└─────────────────┘     └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │     OpenAI API       │
                        │  (Structured Output) │
                        └──────────────────────┘
```

- **Frontend**: Static Preact app on GitHub Pages
- **Backend**: Cloudflare Workers with Durable Objects for game state
- **AI**: OpenAI GPT-4o for spymaster clues, GPT-4o-mini for guesser

## Deployment

### Deploy Backend (Cloudflare Workers)

```bash
cd worker

# Install dependencies (first time / after dependency changes)
npm install

# Set your OpenAI API key
npx wrangler secret put OPENAI_API_KEY

# Deploy
npm run deploy
```

The worker is deployed at: `https://codenames-ai.cschubiner.workers.dev`

### Deploy Frontend (GitHub Pages)

1. Enable GitHub Pages in repository settings:
   - Source: Deploy from branch
   - Branch: `main`
   - Folder: `/docs`

2. Cache-bust the static assets by bumping the version query params in `docs/index.html` (the `?v=` values).

3. Push to `main` (GitHub Pages serves `/docs` from the `main` branch).

### Production API URL

The frontend uses the Worker URL by default:

- `docs/app.js` sets `API_BASE` from `window.CODENAMES_API_URL` (if provided) or falls back to `https://codenames-ai.cschubiner.workers.dev`.

## Project Structure

```
codenames-ai/
├── docs/                  # Frontend (GitHub Pages)
│   ├── index.html         # Entry point
│   ├── app.js             # Preact application
│   └── styles.css         # Styling
├── worker/                # Backend (Cloudflare Workers)
│   ├── src/
│   │   ├── index.ts       # API routes
│   │   ├── game.ts        # Game logic & Durable Object
│   │   ├── ai.ts          # OpenAI integration
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml      # Worker config
│   └── package.json
├── shared/
│   ├── wordlist.json      # 400 official Codenames words
│   ├── configs/           # AI agent configurations
│   └── schemas/           # JSON schemas for AI outputs
├── python/                # Benchmarking harness (for testing AI configs)
├── CLAUDE.md              # Development context for Claude Code
└── README.md              # This file
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/games` | POST | Create new game |
| `/api/games/:code` | GET | Get game state |
| `/api/games/:code/configure` | POST | Set role configuration |
| `/api/games/:code/join` | POST | Join a role |
| `/api/games/:code/start` | POST | Start game |
| `/api/games/:code/clue` | POST | Submit clue |
| `/api/games/:code/guess` | POST | Submit guess |
| `/api/games/:code/end-turn` | POST | End turn |
| `/api/games/:code/ai-clue` | POST | Generate/confirm AI clue |
| `/api/games/:code/ai-suggest` | POST | Get AI suggestions |
| `/api/games/:code/ai-play` | POST | AI makes guess |

## Development

See [CLAUDE.md](./CLAUDE.md) for detailed development documentation.

### Local Development

The worker runs on port 8788 by default. Configure in `worker/wrangler.toml`:

```toml
[dev]
port = 8788
```

Create `worker/.dev.vars` for local secrets:
```
OPENAI_API_KEY=sk-your-key-here
```

## Future Plans

- **Python Benchmarking Harness**: Test different AI configurations
- **Tournament Mode**: Compete AI configurations against each other
- **Replay System**: Watch and analyze past games
- **Custom Word Lists**: Create themed games

## License

MIT
