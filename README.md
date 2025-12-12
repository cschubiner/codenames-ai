# Codenames AI

This repository contains two main components for exploring AI performance in the game Codenames:

## 1. Playable Online Game (`codenames_ai_online`)
A fully functional web-based version of Codenames where humans play as Guessers against AI Spymasters.

- **Frontend**: `codenames_ai_online/docs` (Deployable to GitHub Pages)
- **Backend**: `codenames_ai_online/worker` (Cloudflare Worker + Durable Objects)
- **Features**:
    - AI Spymaster generates clues automatically.
    - AI Guesser can provide hints or play turns for you.
    - Real-time multiplayer synchronization.

**[Read the Full Setup Guide](codenames_ai_online/README.md)**

## 2. LLM Benchmark Harness (`codenames_llm_bench`)
A Python-based framework for benchmarking different LLMs as Spymasters and Guessers.

- **Location**: `codenames_llm_bench/`
- **Purpose**: Run automated matches between different models/prompts to evaluate performance metrics (win rate, rule violations, etc.).
- **Usage**:
    ```bash
    cd codenames_llm_bench
    python scripts/run_match.py ...
    ```

**[Read the Benchmark Guide](codenames_llm_bench/README.md)**

---

## Quick Start (Local Development)

See `Claude.md` for detailed local development and deployment steps.

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- OpenAI API Key

### Running the Online Game Locally
1.  **Backend**:
    ```bash
    cd codenames_ai_online/worker
    npm install
    # Set OPENAI_API_KEY in .dev.vars
    npx wrangler dev --local --port 8787
    ```
2.  **Frontend**:
    ```bash
    cd codenames_ai_online/docs
    # Ensure config.js points to http://localhost:8787
    npx http-server -p 8090
    ```
3.  **Play**: Open `http://localhost:8090` in your browser.