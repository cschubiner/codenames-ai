# Project Status & Deployment Guide

**Date:** December 12, 2025
**Status:** Functional Prototype

## Overview
This project is an online implementation of **Codenames: Humans vs AI Spymasters**.
- **Frontend**: Static HTML/JS serving a modern UI, hosted on GitHub Pages.
- **Backend**: Cloudflare Worker with Durable Objects for state management.
- **AI**: Integrates with OpenAI API (via the Worker) for Spymaster (clue generation) and Guesser (hint generation/auto-play) roles.

## Local Development
1.  **Backend (Worker)**:
    ```bash
    cd codenames_ai_online/worker
    # Ensure OPENAI_API_KEY is in .dev.vars
    npx wrangler dev --local --port 8787
    ```
2.  **Frontend**:
    ```bash
    cd codenames_ai_online/docs
    # Edit config.js to point to http://localhost:8787
    npx http-server -p 8090
    ```

## Deployment Instructions

### 1. Cloudflare Worker (Backend)
The backend logic resides in `codenames_ai_online/worker`.

1.  **Login to Wrangler**:
    ```bash
    npx wrangler login
    ```
2.  **Set Secrets**:
    You must set the OpenAI API key in the production Worker environment.
    ```bash
    npx wrangler secret put OPENAI_API_KEY
    ```
3.  **Deploy**:
    ```bash
    cd codenames_ai_online/worker
    npx wrangler deploy
    ```
4.  **Note the URL**:
    After deployment, Wrangler will output your Worker's URL (e.g., `https://codenames-ai-online.your-subdomain.workers.dev`).

### 2. GitHub Pages (Frontend)
The frontend code resides in `codenames_ai_online/docs`.

1.  **Update Configuration**:
    Edit `codenames_ai_online/docs/config.js` and set the production Worker URL:
    ```javascript
    window.CODENAMES_API_BASE = "https://codenames-ai-online.your-subdomain.workers.dev";
    ```
2.  **Commit & Push**:
    Commit the changes to your git repository.
3.  **Enable GitHub Pages**:
    - Go to your repository settings on GitHub.
    - Navigate to **Pages**.
    - Set the **Source** to "Deploy from a branch".
    - Select your branch (e.g., `main`) and the folder `/docs`.
    - Save.
4.  **Access**:
    Your game will be live at `https://your-username.github.io/your-repo/`.

## Recent Changes
- **Frontend Overhaul**: Modernized HTML5 structure and CSS3 styling (Dark mode, responsive design, improved typography).
- **End-to-End Verification**: Validated full game loop (Create room -> Join -> AI Clue -> Guess -> Turn Switch -> AI Guess).

## To-Do / Future Work
- [ ] Add "Spectator" mode specific UI enhancements.
- [ ] Implement a "Critic" AI agent to evaluate clues before they are shown.
- [ ] Add more presets for different AI models (e.g., Claude, Llama).
