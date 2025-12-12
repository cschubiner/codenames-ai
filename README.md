# Codenames AI

A two-part Codenames AI system combining competitive benchmarking with interactive human gameplay.

## Overview

This project consists of:

1. **Python Benchmarking Harness** - Rigorous framework for testing LLM configurations
2. **Interactive Web Game** - Multiplayer game with AI spymasters (GitHub Pages + Cloudflare Workers)

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
├── python/                    # Benchmarking harness
│   ├── src/
│   │   ├── guesser/          # Guesser LLM interface
│   │   ├── spymaster/        # Spymaster candidate generation
│   │   ├── evaluation/       # Rollout simulation & scoring
│   │   ├── benchmark/        # Benchmark runner & analysis
│   │   └── game/             # Core game logic
│   ├── data/
│   │   ├── boards/           # Pre-generated board sets
│   │   └── results/          # Benchmark results
│   └── tests/
├── worker/                    # Cloudflare Worker backend
│   ├── src/
│   │   ├── index.ts          # Request routing
│   │   ├── game.ts           # Durable Object game room
│   │   └── presets.ts        # Agent preset registry
│   └── wrangler.toml
├── docs/                      # GitHub Pages frontend
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── config.js
└── shared/
    ├── configs/              # Agent configuration JSONs
    ├── prompts/              # Prompt templates
    └── schemas/              # JSON schemas for structured outputs
```

## Deployment Flow

1. Benchmark in Python → identify winning config(s)
2. Copy winning JSON to `shared/configs/`
3. Register in Worker (`worker/src/presets.ts`)
4. Deploy Worker: `npx wrangler deploy`
5. Push to GitHub → Pages auto-deploys
6. Share team links → humans play against your best AI

## Why This Design

1. **No Trained Critic, But Still Strategic** - Simulated gameplay as scoring function
2. **Benchmarking Drives Improvement** - Data-driven prompt engineering
3. **Python ↔ Web Parity** - Same configs in both environments
4. **Extensibility** - Easy to add new models, aggregation strategies, or learned critics
5. **Structured Outputs** - Eliminates parsing issues, guarantees valid moves

## Future Extensions

- Learned critic for fast pre-filtering
- Fine-tuning on winning clues
- Human gameplay data collection
- Multi-agent coaching
- Adversarial training
- Tournament mode

## License

MIT
