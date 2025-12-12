# Codenames: Humans vs AI Spymasters (GitHub Pages + Cloudflare Workers)

This repo is a **playable online Codenames** variant:

- **Humans are the guessers** (split into **Red** and **Blue** teams).
- **Each team has an AI spymaster** (LLM).
- At any time, humans can click **“AI suggest guesses”** or **“AI play next guess”** to have an LLM guess for them.
- Frontend is a static site hosted on **GitHub Pages** (`/docs`).
- Backend is a **Cloudflare Worker** (deployed with **Wrangler**) + a **Durable Object** that stores game state.

The AI spymaster/guesser configs are intentionally compatible with the **Python benchmarking harness** you already have:
- The worker loads agent configs from `shared/configs/*.json` (same format as the Python `configs/*.json`).

---

## Architecture

- **GitHub Pages** serves:
  - `docs/index.html`
  - `docs/app.js`
  - `docs/styles.css`
  - `docs/config.js` (you edit this to point at your Worker URL)

- **Cloudflare Worker** exposes a JSON API under `/api/*` and proxies per-room endpoints to a **Durable Object**.
- The Durable Object stores:
  - board words
  - hidden key (RED / BLUE / NEUTRAL / ASSASSIN)
  - revealed cards
  - whose turn
  - current clue/number
  - players list

---

## 1) Deploy the Cloudflare Worker backend

### Prereqs
- Node.js 18+ recommended
- Wrangler installed via `npm` (included in this repo)

### Install + login
```bash
cd worker
npm install
npx wrangler login
```

### Set your OpenAI API key (stored as a Worker secret)
```bash
npx wrangler secret put OPENAI_API_KEY
```

### (Optional) restrict CORS
By default, the Worker allows `Access-Control-Allow-Origin: *` for ease of use.
If you want to restrict it, set:
```bash
npx wrangler secret put ALLOWED_ORIGINS
```
…with a comma-separated list of allowed origins, e.g.:
`https://YOURUSER.github.io`

### Deploy
```bash
npx wrangler deploy
```

Wrangler will print a URL like:
`https://codenames-ai-online.YOURNAME.workers.dev`

Copy that.

---

## 2) Host the frontend on GitHub Pages

### Configure the API base URL
Edit:
- `docs/config.js`

Set:
```js
window.CODENAMES_API_BASE = "https://YOUR_WORKER_URL";
```

### Enable GitHub Pages
In GitHub:
- Settings → Pages
- “Build and deployment” → Source: **Deploy from a branch**
- Branch: `main` (or `master`)
- Folder: `/docs`

Your site will be available at:
`https://YOURUSER.github.io/YOURREPO/`

---

## 3) Play!

1. Open the GitHub Pages URL.
2. Click **Create room**.
3. Share the team links with friends:
   - Red team link
   - Blue team link

Gameplay notes:
- The AI spymaster generates the clue for the team whose turn it is.
- Click words on your turn to guess.
- Click **Stop** to end your turn early.
- Click **AI suggest guesses** anytime to see what the guesser LLM would do.
- Click **AI play next guess** to have the AI submit a guess for your team.

---

## 4) Using the same AI configs as your Python benchmark

Agent config JSON files live in:
- `shared/configs/*.json`

They match the Python harness format:
- `spymaster.model`, `spymaster.prompt_id`, `spymaster.candidates_per_turn`, etc.
- `guesser.model`, `guesser.prompt_id`, etc.
- `selection.eval_samples_per_candidate`, etc.

To add more presets:
1. Copy a config JSON from your Python repo into `shared/configs/`
2. Redeploy the Worker (it bundles these configs at build time)

---

## Troubleshooting

- If the frontend shows CORS errors:
  - make sure the Worker returns CORS headers (default is permissive)
  - verify `docs/config.js` points at your Worker URL (including `https://`)
- If clue generation is slow:
  - reduce `spymaster.candidates_per_turn` and/or `selection.eval_samples_per_candidate`
  - use smaller/cheaper models

---

## License
This repo includes a small **custom word list** (not the official Codenames list).
