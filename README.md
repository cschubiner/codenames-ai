# Codenames AI

A two-part Codenames AI system combining competitive benchmarking with interactive human gameplay.

**[Play Now](https://your-username.github.io/codenames-ai)** | **[API Docs](#api-endpoints)**

## Overview

This project consists of:

1. **Python Benchmarking Harness** (`codenames_bench/`) - Rigorous framework for testing LLM configurations
2. **Interactive Web Game** (`worker/` + `docs/`) - Multiplayer game with AI spymasters (GitHub Pages + Cloudflare Workers)

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- Cloudflare account (for deployment)
- OpenAI API key

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/your-username/codenames-ai.git
cd codenames-ai

# 2. Set up the Worker
cd worker
npm install

# 3. Create .dev.vars with your API key
echo "OPENAI_API_KEY=your-key-here" > .dev.vars

# 4. Start the backend
npx wrangler dev --port 8787

# 5. In another terminal, serve the frontend
cd ../docs
python3 -m http.server 5173

# 6. Open http://localhost:5173
```

## Architecture

### Part 1: Python Benchmarking Harness

#### Guesser (No Training)
- Pure LLM-based using OpenAI's Structured Outputs with JSON Schema
- Dynamic enum generation of only current unrevealed board words
- Returns ordered guesses with confidence scores
- No neural network training required

#### Spymaster (Where Intelligence Lives)
- Generates K candidate clues per turn (configurable, e.g., 4-16 samples)
- Each candidate includes: clue word, number, and intended targets
- Evaluation via simulation:
  - Run guesser LLM G times (e.g., 1-4 rollouts) per candidate
  - Apply guesses to hidden key
  - Compute shaped reward (+1 per correct, -10 for assassin)
  - Aggregate across rollouts (mean, mean-σ, percentile, etc.)
- Select highest-scoring candidate

**Key Innovation**: The guesser LLM *is* the evaluation function. No separate value network—actual simulated gameplay scores each clue proposal.

#### Benchmarking Goals
- Best guesser prompt and model
- Best spymaster prompt and model
- Optimal K (candidates per turn) and G (rollouts per candidate)
- Risk aggregation strategy (mean vs. pessimistic bound vs. CVaR)
- Combined configurations

#### Benchmark Methodology
- **Fixed Board Sets**: Pre-generated dev (~100) and holdout (~1000) boards
- **Mirror Matches**: Play twice with teams swapped to cancel first-move advantage
- **Replicates**: R replicates per board (3-10) with different seeds
- **Metrics**: Win rate, assassin loss rate, opponent-flip rate, correct words per clue, cost, latency

### Part 2: Interactive Web Game

#### Game Structure
- Two human teams (RED and BLUE guessers)
- Two AI spymasters (one per team)
- AI assistance buttons: "AI suggest guesses" and "AI play next guess"

#### Technical Stack
- **Frontend**: Static site on GitHub Pages (`/docs/`)
- **Backend**: Cloudflare Workers + Durable Objects
- **AI Integration**: OpenAI Responses API with Structured Outputs

### Shared Configuration System

Configs in `shared/configs/*.json`:

```json
{
  "name": "AgentA",
  "spymaster": {
    "model": "gpt-4o",
    "prompt_id": "spymaster_v2",
    "temperature": 0.7,
    "candidates_per_turn": 8
  },
  "guesser": {
    "model": "gpt-4o-mini",
    "prompt_id": "guesser_v1",
    "temperature": 0.2
  },
  "selection": {
    "eval_samples_per_candidate": 3,
    "eval_temperature": 0.3,
    "aggregation": "mean_minus_std"
  }
}
```

These configs are used by both the Python harness and the web game—**what you benchmark is exactly what humans play against**.

## Project Structure

```
codenames-ai/
├── codenames_bench/           # Python benchmarking harness
│   ├── __init__.py
│   ├── core.py               # Core game logic
│   ├── schemas.py            # JSON schemas for LLM outputs
│   └── openai_responses.py   # OpenAI API wrapper
├── configs/                   # Agent configuration files
│   ├── agent_a.json
│   └── agent_b.json
├── scripts/                   # Benchmark runner scripts
│   └── run_benchmark.py
├── worker/                    # Cloudflare Worker backend
│   ├── src/
│   │   ├── index.ts          # Request routing & CORS
│   │   ├── game.ts           # Durable Object game room
│   │   ├── ai.ts             # AI spymaster/guesser logic
│   │   ├── openai.ts         # OpenAI Chat Completions API
│   │   ├── schemas.ts        # JSON Schema definitions
│   │   └── presets.ts        # Agent preset registry
│   ├── wrangler.toml         # Cloudflare config
│   └── .dev.vars             # Local secrets (not committed)
├── docs/                      # GitHub Pages frontend
│   ├── index.html            # Main HTML
│   ├── styles.css            # Styling
│   ├── app.js                # Game logic
│   └── config.js             # API endpoint config
├── data/                      # Word lists
│   └── words.json
├── CLAUDE.md                  # Development guide for Claude Code
└── README.md
```

## Deployment

### Deploy Worker to Cloudflare

```bash
cd worker

# Login to Cloudflare (first time only)
npx wrangler login

# Set the API key secret
npx wrangler secret put OPENAI_API_KEY

# Deploy
npx wrangler deploy
```

After deployment, note your Worker URL (e.g., `https://codenames-ai.your-subdomain.workers.dev`).

### Deploy Frontend to GitHub Pages

1. Update `docs/config.js` with your Worker URL:
   ```javascript
   window.CODENAMES_API_BASE = "https://codenames-ai.your-subdomain.workers.dev";
   ```

2. Enable GitHub Pages:
   - Repository Settings → Pages
   - Source: Deploy from branch
   - Branch: `main`, Folder: `/docs`

3. Push to GitHub - auto-deploys to `https://your-username.github.io/codenames-ai`

### Deployment Workflow

1. Benchmark in Python → identify winning config(s)
2. Copy winning JSON to `configs/`
3. Register in Worker (`worker/src/presets.ts`)
4. Deploy Worker: `npx wrangler deploy`
5. Push to GitHub → Pages auto-deploys
6. Share team links → humans play against your best AI

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/presets` | GET | List available AI agent presets |
| `/api/rooms` | POST | Create a new game room |
| `/api/rooms/:id/join` | POST | Join a room as a player |
| `/api/rooms/:id/state` | GET | Get current game state |
| `/api/rooms/:id/guess` | POST | Make a guess |
| `/api/rooms/:id/stop` | POST | End guessing turn (pass) |
| `/api/rooms/:id/ai_guess` | POST | Get AI guess suggestions |
| `/api/rooms/:id/ai_play_next` | POST | Let AI make next guess |
| `/api/rooms/:id/reset` | POST | Reset game with new board |

## Why This Design

1. **No Trained Critic, But Still Strategic** - Simulated gameplay as scoring function
2. **Benchmarking Drives Improvement** - Data-driven prompt engineering
3. **Python ↔ Web Parity** - Same configs in both environments
4. **Extensibility** - Easy to add new models, aggregation strategies, or learned critics
5. **Structured Outputs** - Eliminates parsing issues, guarantees valid moves

## Future Extensions

### Jackbox-Style Flexible Player System (Planned)

Transform the game into a Jackbox-style party game with maximum flexibility:

**TV Display Mode**
- Main game board displayed on a shared screen (TV, projector)
- Players join via their phones/devices using room codes
- Clean spectator view for the main display

**Flexible Team Composition**
Any combination of human and AI players:

| Red Spymaster | Blue Spymaster | Red Guessers | Blue Guessers |
|---------------|----------------|--------------|---------------|
| Human | Human | Human | Human | Classic all-human game |
| Human | AI | Human | Human | One human SM vs AI |
| AI | AI | Human | Human | Current mode - humans guess, AI gives clues |
| AI | AI | Human | AI | Single team plays against full AI |
| AI | AI | AI | AI | Watch AI vs AI (demo mode) |
| Human | Human | AI | AI | Human SMs, AI guessers |

**Controller Roles**
- Even in full AI mode, one human "controller" can approve/override guesses
- Useful for teaching, demos, or just watching with intervention ability

**Implementation Plan**
1. Add role selection on join (Spymaster vs Guesser)
2. Add "waiting for human" vs "AI will play" toggles per role
3. TV display mode (no controls, just board + status)
4. Phone-friendly responsive UI for players
5. Room code system for easy joining

### Other Future Work

- Learned critic for fast pre-filtering
- Fine-tuning on winning clues
- Human gameplay data collection
- Multi-agent coaching
- Adversarial training
- Tournament mode

## License

MIT
