const API_BASE = (window.CODENAMES_API_BASE || "").replace(/\/$/, "");

const el = (id) => document.getElementById(id);

const views = {
  configWarning: el("configWarning"),
  createView: el("createView"),
  joinView: el("joinView"),
  gameView: el("gameView"),
  createResult: el("createResult"),
  redPreset: el("redPreset"),
  bluePreset: el("bluePreset"),
  createRoomBtn: el("createRoomBtn"),
  redLink: el("redLink"),
  blueLink: el("blueLink"),
  specLink: el("specLink"),
  roomIdInput: el("roomIdInput"),
  nameInput: el("nameInput"),
  teamSelect: el("teamSelect"),
  joinBtn: el("joinBtn"),
  continueBox: el("continueBox"),
  continueLabel: el("continueLabel"),
  continueBtn: el("continueBtn"),
  forgetBtn: el("forgetBtn"),

  roomLabel: el("roomLabel"),
  youLabel: el("youLabel"),
  redScore: el("redScore"),
  blueScore: el("blueScore"),
  clueSection: el("clueSection"),
  turnIndicator: el("turnIndicator"),
  clueWord: el("clueWord"),
  clueNumber: el("clueNumber"),
  guessProgress: el("guessProgress"),
  statusBanner: el("statusBanner"),
  stopBtn: el("stopBtn"),
  aiSuggestBtn: el("aiSuggestBtn"),
  aiPlayBtn: el("aiPlayBtn"),
  resetBtn: el("resetBtn"),

  aiBox: el("aiBox"),
  aiList: el("aiList"),

  board: el("board"),
  playersList: el("playersList"),
  historyList: el("historyList"),
};

let currentRoom = null;
let player = null; // {player_id, token, name, team}
let pollTimer = null;
let lastVersion = 0;

function show(elem, yes) {
  if (elem) elem.classList.toggle("hidden", !yes);
}

function warn(msg) {
  views.configWarning.textContent = msg;
  show(views.configWarning, true);
}

async function apiGet(path) {
  const r = await fetch(API_BASE + path, { method: "GET" });
  const t = await r.text();
  if (!r.ok) throw new Error(`GET ${path} failed: ${t}`);
  return JSON.parse(t);
}

async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`POST ${path} failed: ${t}`);
  return JSON.parse(t);
}

function storageKey(roomId) {
  return `codenames_player_${roomId}`;
}
function loadSaved(roomId) {
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function savePlayer(roomId, p) {
  localStorage.setItem(storageKey(roomId), JSON.stringify(p));
}
function forgetPlayer(roomId) {
  localStorage.removeItem(storageKey(roomId));
}

function parseParams() {
  const qs = new URLSearchParams(location.search);
  return {
    room: qs.get("room") || "",
    team: (qs.get("team") || "").toUpperCase() || "",
  };
}

function setJoinLinks(roomId) {
  const base = new URL(location.href);
  base.search = "";
  base.hash = "";

  const mk = (team) => {
    const u = new URL(base.toString());
    u.searchParams.set("room", roomId);
    u.searchParams.set("team", team);
    return u.toString();
  };

  views.redLink.href = mk("RED");
  views.blueLink.href = mk("BLUE");
  views.specLink.href = mk("SPECTATOR");
}

async function loadPresets() {
  if (!API_BASE || API_BASE.includes("YOUR_WORKER_URL")) {
    warn("Edit docs/config.js and set window.CODENAMES_API_BASE to your Worker URL.");
    return;
  }
  const data = await apiGet("/api/presets");
  const presets = data.presets || [];

  // Fill dropdowns
  const optHtml = presets
    .map(
      (p) =>
        `<option value="${p.id}">${p.name}</option>`,
    )
    .join("");

  views.redPreset.innerHTML = optHtml;
  views.bluePreset.innerHTML = optHtml;

  // preselect
  if (presets[0]) {
    views.redPreset.value = presets[0].id;
    views.bluePreset.value = presets[0].id;
  }
}

async function createRoom() {
  const red_agent = views.redPreset.value;
  const blue_agent = views.bluePreset.value;

  const res = await apiPost("/api/rooms", { red_agent, blue_agent });
  const roomId = res.room_id;

  setJoinLinks(roomId);
  show(views.createResult, true);

  // also switch to join view automatically
  location.search = `?room=${roomId}&team=SPECTATOR`;
}

async function showJoinView(roomId, teamHint) {
  show(views.createView, false);
  show(views.joinView, true);
  show(views.gameView, false);

  views.roomIdInput.value = roomId || "";
  if (teamHint) views.teamSelect.value = teamHint;

  // saved player?
  if (roomId) {
    const saved = loadSaved(roomId);
    if (saved?.player_id && saved?.token) {
      show(views.continueBox, true);
      views.continueLabel.textContent = `${saved.name} (${saved.team})`;
      views.continueBtn.onclick = () => {
        player = saved;
        currentRoom = roomId;
        startGame();
      };
      views.forgetBtn.onclick = () => {
        forgetPlayer(roomId);
        show(views.continueBox, false);
      };
    } else {
      show(views.continueBox, false);
    }
  } else {
    show(views.continueBox, false);
  }
}

async function joinRoom() {
  const roomId = (views.roomIdInput.value || "").trim();
  const name = (views.nameInput.value || "").trim() || "Player";
  const team = views.teamSelect.value || "SPECTATOR";

  if (!roomId) throw new Error("Room id required");

  const res = await apiPost(`/api/rooms/${roomId}/join`, { name, team });
  player = {
    player_id: res.player_id,
    token: res.token,
    name: res.name,
    team: res.team,
  };
  currentRoom = roomId;
  savePlayer(roomId, player);

  startGame();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(fetchAndRender, 1500);
}

async function startGame() {
  show(views.createView, false);
  show(views.joinView, false);
  show(views.gameView, true);

  views.roomLabel.textContent = currentRoom;

  // Set player badge
  const teamClass = (player?.team || "").toLowerCase();
  views.youLabel.textContent = player?.name || "?";
  views.youLabel.className = `team-badge ${teamClass}`;

  views.stopBtn.onclick = async () => {
    await apiPost(`/api/rooms/${currentRoom}/stop`, { ...player });
    await fetchAndRender(true);
  };
  views.aiSuggestBtn.onclick = async () => {
    await aiSuggest();
  };
  views.aiPlayBtn.onclick = async () => {
    await aiPlayNext();
  };
  views.resetBtn.onclick = async () => {
    if (confirm("Start a new game? This will reset the board.")) {
      await apiPost(`/api/rooms/${currentRoom}/reset`, { ...player });
      await fetchAndRender(true);
    }
  };

  await fetchAndRender(true);
  startPolling();
}

function renderBanner(text, type = "info", showIt = true) {
  views.statusBanner.textContent = text;
  views.statusBanner.className = `banner ${type}`;
  show(views.statusBanner, showIt);
}

function buildRevealedMap(history) {
  const map = new Map(); // word -> card_type
  for (const ev of history || []) {
    if (ev.t === "guess") {
      map.set(ev.word, ev.result);
    }
  }
  return map;
}

function cardClass(cardType) {
  if (!cardType) return "";
  const t = cardType.toLowerCase();
  if (t === "red") return "red";
  if (t === "blue") return "blue";
  if (t === "neutral") return "neutral";
  if (t === "assassin") return "assassin";
  return "";
}

function updateClueSection(state) {
  const turn = state.turn || "?";
  const turnClass = turn.toLowerCase();

  views.turnIndicator.textContent = `${turn}'s Turn`;
  views.turnIndicator.className = `turn-indicator ${turnClass}`;

  if (state.ended) {
    views.clueSection.className = "clue-section";
    views.clueWord.textContent = "GAME OVER";
    views.clueNumber.textContent = "";
    views.guessProgress.textContent = "";
  } else if (state.clue?.status === "pending") {
    views.clueSection.className = "clue-section pending";
    views.clueWord.innerHTML = '<span class="loading-text">AI generating clue</span>';
    views.clueNumber.textContent = "";
    views.guessProgress.textContent = "";
  } else if (state.clue?.status === "ready") {
    views.clueSection.className = "clue-section";
    views.clueWord.textContent = state.clue.clue || "?";
    views.clueNumber.textContent = state.clue.number || "?";
    views.guessProgress.innerHTML = `Guesses: <span class="current">${state.guesses_made_this_turn}</span> / ${state.max_guesses_this_turn}`;
  }
}

function updateScores(state) {
  // Count remaining words for each team
  let redRemaining = 0;
  let blueRemaining = 0;

  const revealedMap = buildRevealedMap(state.history);

  for (let i = 0; i < 25; i++) {
    const word = state.board_words[i];
    const isRevealed = state.revealed[i];

    if (!isRevealed) {
      // We don't know the key, so count revealed ones
      // Actually for unrevealed we can't know - let's count from history
    }

    // Count revealed cards by type
    if (isRevealed) {
      const cardType = revealedMap.get(word);
      // Count for "found" not "remaining"
    }
  }

  // Count revealed of each type
  let redFound = 0, blueFound = 0;
  for (const [word, cardType] of revealedMap) {
    if (cardType === "RED") redFound++;
    if (cardType === "BLUE") blueFound++;
  }

  // Starting team has 9, other has 8
  const redTotal = state.starting_team === "RED" ? 9 : 8;
  const blueTotal = state.starting_team === "BLUE" ? 9 : 8;

  views.redScore.textContent = redTotal - redFound;
  views.blueScore.textContent = blueTotal - blueFound;
}

function renderBoard(state) {
  const revealedMap = buildRevealedMap(state.history);

  // Build buttons once
  if (views.board.childElementCount !== 25) {
    views.board.innerHTML = "";
    for (let i = 0; i < 25; i++) {
      const btn = document.createElement("button");
      btn.className = "cardbtn";
      btn.onclick = async () => {
        const w = btn.dataset.word;
        if (!w) return;
        try {
          await apiPost(`/api/rooms/${currentRoom}/guess`, { ...player, word: w });
          await fetchAndRender(true);
        } catch (e) {
          renderBanner(String(e?.message || e), "error", true);
        }
      };
      views.board.appendChild(btn);
    }
  }

  // Update each button
  const canGuess =
    !state.ended &&
    state.clue?.status === "ready" &&
    player?.team === state.turn;

  for (let i = 0; i < 25; i++) {
    const w = state.board_words[i];
    const rev = state.revealed[i];
    const btn = views.board.children[i];
    btn.dataset.word = w;
    btn.textContent = w;

    btn.disabled = !canGuess || rev;

    btn.classList.remove("revealed", "red", "blue", "neutral", "assassin");
    if (rev) {
      const ct = revealedMap.get(w);
      btn.classList.add("revealed");
      btn.classList.add(cardClass(ct));
      btn.disabled = true;
    }
  }
}

function renderPlayers(players) {
  views.playersList.innerHTML = "";
  for (const p of players || []) {
    const div = document.createElement("div");
    div.className = "player-item";
    const teamClass = (p.team || "spectator").toLowerCase();
    div.innerHTML = `<span class="name">${p.name}</span><span class="team-tag ${teamClass}">${p.team}</span>`;
    views.playersList.appendChild(div);
  }
}

function renderHistory(history) {
  const items = (history || []).slice(-30).reverse();
  views.historyList.innerHTML = "";
  for (const ev of items) {
    const div = document.createElement("div");
    div.className = `history-item ${getHistoryClass(ev)}`;
    const ts = ev.at ? new Date(ev.at).toLocaleTimeString() : "";
    div.innerHTML = `<span class="time">${ts}</span>${formatEvent(ev)}`;
    views.historyList.appendChild(div);
  }
}

function getHistoryClass(ev) {
  if (ev.t === "clue_ready") return "clue";
  if (ev.t === "guess") {
    return ev.result === ev.team ? "guess-correct" : "guess-wrong";
  }
  if (ev.t === "turn_end") return "turn-end";
  if (ev.t === "game_end") return "game-end";
  return "";
}

function formatEvent(ev) {
  if (ev.t === "clue_ready") return `<strong>${ev.team}</strong> clue: ${ev.clue} (${ev.number})`;
  if (ev.t === "guess") return `<strong>${ev.team}</strong> guessed ${ev.word} - ${ev.result}`;
  if (ev.t === "turn_end") return `Turn ends, next: ${ev.next_team}`;
  if (ev.t === "stop") return `<strong>${ev.team}</strong> passed`;
  if (ev.t === "player_joined") return `${ev.name} joined ${ev.team}`;
  if (ev.t === "game_end") return `<strong>GAME OVER</strong> - ${ev.winner} wins!`;
  if (ev.t === "reset") return `New game started`;
  return ev.t;
}

function renderState(state) {
  updateClueSection(state);
  updateScores(state);

  if (state.ended) {
    const winnerClass = state.winner === "RED" ? "red-wins" : "blue-wins";
    views.statusBanner.className = `banner game-over ${winnerClass}`;
    views.statusBanner.textContent = `${state.winner} WINS!`;
    show(views.statusBanner, true);
  } else if (state.clue?.status === "pending") {
    renderBanner("AI spymaster is thinking...", "info", true);
  } else {
    show(views.statusBanner, false);
  }

  renderBoard(state);
  renderPlayers(state.players);
  renderHistory(state.history);

  // Enable/disable buttons
  const myTurn = player?.team === state.turn;
  const clueReady = state.clue?.status === "ready";
  const gameActive = !state.ended;

  views.stopBtn.disabled = !(myTurn && clueReady && gameActive);
  views.aiPlayBtn.disabled = !(myTurn && clueReady && gameActive);
  views.aiSuggestBtn.disabled = !(clueReady && gameActive);
  views.resetBtn.disabled = false;
}

async function fetchAndRender(force = false) {
  if (!currentRoom) return;

  const state = await apiGet(`/api/rooms/${currentRoom}/state`);
  if (!force && state.version === lastVersion) return;
  lastVersion = state.version;
  renderState(state);
}

async function aiSuggest() {
  try {
    views.aiSuggestBtn.disabled = true;
    views.aiSuggestBtn.textContent = "Loading...";

    const res = await apiPost(`/api/rooms/${currentRoom}/ai_guess`, { ...player });
    show(views.aiBox, true);
    const list = res.guesses || [];
    views.aiList.innerHTML = "";

    if (!list.length) {
      views.aiList.innerHTML = '<div class="suggestion"><span class="word">No suggestions</span></div>';
      return;
    }

    for (const g of list) {
      const div = document.createElement("div");
      div.className = "suggestion";
      const conf = (g.confidence ?? 0) * 100;
      const confClass = conf >= 70 ? "high" : conf >= 40 ? "medium" : "";
      div.innerHTML = `<span class="word">${g.word}</span><span class="confidence ${confClass}">${conf.toFixed(0)}%</span>`;
      views.aiList.appendChild(div);
    }
  } catch (e) {
    renderBanner(String(e?.message || e), "error", true);
  } finally {
    views.aiSuggestBtn.disabled = false;
    views.aiSuggestBtn.textContent = "AI Suggest";
  }
}

async function aiPlayNext() {
  try {
    views.aiPlayBtn.disabled = true;
    views.aiPlayBtn.textContent = "Playing...";

    await apiPost(`/api/rooms/${currentRoom}/ai_play_next`, { ...player });
    await fetchAndRender(true);
  } catch (e) {
    renderBanner(String(e?.message || e), "error", true);
  } finally {
    views.aiPlayBtn.disabled = false;
    views.aiPlayBtn.textContent = "AI Play Next";
  }
}

// --------------------
// Init
// --------------------

(async function main() {
  await loadPresets();

  const params = parseParams();

  views.createRoomBtn.onclick = async () => {
    try {
      views.createRoomBtn.disabled = true;
      views.createRoomBtn.textContent = "Creating...";
      await createRoom();
    } catch (e) {
      warn(String(e?.message || e));
      views.createRoomBtn.disabled = false;
      views.createRoomBtn.textContent = "Create Room";
    }
  };

  views.joinBtn.onclick = async () => {
    try {
      views.joinBtn.disabled = true;
      views.joinBtn.textContent = "Joining...";
      await joinRoom();
    } catch (e) {
      warn(String(e?.message || e));
      views.joinBtn.disabled = false;
      views.joinBtn.textContent = "Join Game";
    }
  };

  if (params.room) {
    await showJoinView(params.room, params.team || "SPECTATOR");
  } else {
    // show create by default
    show(views.createView, true);
    show(views.joinView, false);
    show(views.gameView, false);
  }
})();
