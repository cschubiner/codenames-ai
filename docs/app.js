const API_BASE = (window.CODENAMES_API_BASE || "").replace(/\/$/, "");

const el = (id) => document.getElementById(id);

const views = {
  configWarning: el("configWarning"),
  createView: el("createView"),
  joinView: el("joinView"),
  gameView: el("gameView"),
  hero: el("hero"),
  createResult: el("createResult"),
  redPreset: el("redPreset"),
  bluePreset: el("bluePreset"),
  createRoomBtn: el("createRoomBtn"),
  showJoinBtn: el("showJoinBtn"),
  redLink: el("redLink"),
  blueLink: el("blueLink"),
  specLink: el("specLink"),
  roomIdInput: el("roomIdInput"),
  nameInput: el("nameInput"),
  teamSelect: el("teamSelect"),
  roleSelect: el("roleSelect"),
  joinBtn: el("joinBtn"),
  backToCreateBtn: el("backToCreateBtn"),
  continueBox: el("continueBox"),
  continueLabel: el("continueLabel"),
  continueBtn: el("continueBtn"),
  forgetBtn: el("forgetBtn"),

  roomLabel: el("roomLabel"),
  youLabel: el("youLabel"),
  turnLabel: el("turnLabel"),
  clueLabel: el("clueLabel"),
  guessCountLabel: el("guessCountLabel"),
  statusBanner: el("statusBanner"),
  stopBtn: el("stopBtn"),
  aiSuggestBtn: el("aiSuggestBtn"),
  aiPlayBtn: el("aiPlayBtn"),
  resetBtn: el("resetBtn"),

  humanClueBox: el("humanClueBox"),
  humanClueInput: el("humanClueInput"),
  humanClueNumber: el("humanClueNumber"),
  humanClueSubmit: el("humanClueSubmit"),

  aiBox: el("aiBox"),
  aiList: el("aiList"),

  board: el("board"),
  playersList: el("playersList"),
  historyList: el("historyList"),
};

let currentRoom = null;
let player = null; // {player_id, token, name, team, role}
let pollTimer = null;
let lastVersion = 0;
let spymasterKey = null; // key array for spymaster view

function show(elem, yes) {
  elem.classList.toggle("hidden", !yes);
}

function showHero(yes) {
  if (views.hero) show(views.hero, yes);
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
    role: (qs.get("role") || "").toUpperCase() || "",
  };
}

function setJoinLinks(roomId) {
  const base = new URL(location.href);
  base.search = "";
  base.hash = "";

  const mk = (team, role) => {
    const u = new URL(base.toString());
    u.searchParams.set("room", roomId);
    u.searchParams.set("team", team);
    if (role) u.searchParams.set("role", role);
    return u.toString();
  };

  views.redLink.href = mk("RED");
  views.blueLink.href = mk("BLUE");
  views.specLink.href = mk("SPECTATOR", "SPECTATOR");
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
        `<option value="${p.id}">${p.id} — ${p.name} (S:${p.spymaster_model} / G:${p.guesser_model})</option>`,
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

async function showJoinView(roomId, teamHint, roleHint) {
  showHero(true);
  show(views.createView, false);
  show(views.joinView, true);
  show(views.gameView, false);

  views.roomIdInput.value = roomId || "";
  if (teamHint) views.teamSelect.value = teamHint;
  if (roleHint) {
    views.roleSelect.value = roleHint;
  } else {
    views.roleSelect.value = teamHint === "SPECTATOR" ? "SPECTATOR" : "GUESSER";
  }

  // Keep team/role consistent.
  views.roleSelect.onchange = () => {
    const r = views.roleSelect.value;
    if (r === "SPECTATOR" || r === "CONTROLLER") {
      views.teamSelect.value = "SPECTATOR";
    } else if (views.teamSelect.value === "SPECTATOR") {
      views.teamSelect.value = "RED";
    }
  };
  views.teamSelect.onchange = () => {
    const t = views.teamSelect.value;
    if (t === "SPECTATOR" && views.roleSelect.value !== "SPECTATOR" && views.roleSelect.value !== "CONTROLLER") {
      views.roleSelect.value = "SPECTATOR";
    }
    if (t !== "SPECTATOR" && views.roleSelect.value === "SPECTATOR") {
      views.roleSelect.value = "GUESSER";
    }
  };

  // saved player?
  if (roomId) {
    const saved = loadSaved(roomId);
    if (saved?.player_id && saved?.token) {
      show(views.continueBox, true);
      views.continueLabel.textContent = `${saved.name} (${saved.team})`;
      views.continueBtn.onclick = () => {
        player = {
          ...saved,
          role: saved.role || (saved.team === "SPECTATOR" ? "SPECTATOR" : "GUESSER"),
        };
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
  let team = views.teamSelect.value || "SPECTATOR";
  let role = views.roleSelect.value || (team === "SPECTATOR" ? "SPECTATOR" : "GUESSER");
  if (role === "SPECTATOR" || role === "CONTROLLER") team = "SPECTATOR";

  if (!roomId) throw new Error("Room id required");

  const res = await apiPost(`/api/rooms/${roomId}/join`, { name, team, role });
  player = {
    player_id: res.player_id,
    token: res.token,
    name: res.name,
    team: res.team,
    role: res.role,
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
  showHero(false);
  show(views.createView, false);
  show(views.joinView, false);
  show(views.gameView, true);

  views.roomLabel.textContent = currentRoom;
  views.youLabel.textContent = `${player?.name || "?"} (${player?.team || "?"}/${player?.role || "?"})`;

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
    await apiPost(`/api/rooms/${currentRoom}/reset`, { ...player });
    await fetchAndRender(true);
  };

  views.humanClueSubmit.onclick = async () => {
    await submitHumanClue();
  };

  // Load spymaster key if needed.
  spymasterKey = null;
  if (player?.role === "SPYMASTER" && player?.team !== "SPECTATOR") {
    try {
      const kres = await apiPost(`/api/rooms/${currentRoom}/key`, { ...player });
      spymasterKey = kres.key || null;
    } catch (e) {
      renderBanner(`Failed to load key: ${e?.message || e}`, true);
    }
  }

  await fetchAndRender(true);
  startPolling();
}

function renderBanner(text, showIt = true) {
  views.statusBanner.textContent = text;
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

function setTurnPill(team) {
  views.turnLabel.textContent = team || "?";
  views.turnLabel.classList.remove("red", "blue");
  if (team === "RED") views.turnLabel.classList.add("red");
  if (team === "BLUE") views.turnLabel.classList.add("blue");
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
          renderBanner(String(e?.message || e), true);
        }
      };
      views.board.appendChild(btn);
    }
  }

  // Update each button
  const isController = player?.role === "CONTROLLER";
  const isSpymaster = player?.role === "SPYMASTER";
  const isSpectator = player?.role === "SPECTATOR" || player?.team === "SPECTATOR";
  const canGuess =
    !state.ended &&
    state.clue?.status === "ready" &&
    !isSpymaster &&
    !isSpectator &&
    (player?.team === state.turn || isController);

  for (let i = 0; i < 25; i++) {
    const w = state.board_words[i];
    const rev = state.revealed[i];
    const btn = views.board.children[i];
    btn.dataset.word = w;
    btn.textContent = w;

    btn.disabled = !canGuess || rev;

    btn.classList.remove("revealed", "hint", "red", "blue", "neutral", "assassin");
    if (rev) {
      const ct = revealedMap.get(w);
      btn.classList.add("revealed");
      btn.classList.add(cardClass(ct));
      btn.disabled = true;
    } else if (isSpymaster && Array.isArray(spymasterKey)) {
      const ct = spymasterKey[i];
      btn.classList.add("hint");
      btn.classList.add(cardClass(ct));
    }
  }
}

function renderPlayers(players) {
  views.playersList.innerHTML = "";
  for (const p of players || []) {
    const div = document.createElement("div");
    div.className = "p";
    const roleTag = p.role ? ` <span class="tag">${p.role}</span>` : "";
    div.innerHTML = `<div><span class="mono">${p.name}</span> <span class="tag">${p.team}</span>${roleTag}</div><div class="tag">${new Date(p.joined_at).toLocaleTimeString()}</div>`;
    views.playersList.appendChild(div);
  }
}

function renderHistory(history) {
  const items = (history || []).slice(-30).reverse();
  views.historyList.innerHTML = "";
  for (const ev of items) {
    const div = document.createElement("div");
    div.className = "h";
    div.textContent = formatEvent(ev);
    views.historyList.appendChild(div);
  }
}

function formatEvent(ev) {
  const ts = ev.at ? new Date(ev.at).toLocaleTimeString() : "";
  if (ev.t === "clue_ready") return `${ts} • CLUE for ${ev.team}: ${ev.clue} (${ev.number})`;
  if (ev.t === "guess") return `${ts} • ${ev.team} guessed ${ev.word} → ${ev.result}`;
  if (ev.t === "turn_end") return `${ts} • Turn ends → ${ev.next_team} (${ev.reason})`;
  if (ev.t === "stop") return `${ts} • ${ev.team} stopped`;
  if (ev.t === "player_joined") return `${ts} • ${ev.name} joined as ${ev.team}${ev.role ? "/" + ev.role : ""}`;
  if (ev.t === "game_end") return `${ts} • GAME OVER → ${ev.winner} (${ev.reason})`;
  if (ev.t === "reset") return `${ts} • New game started`;
  return `${ts} • ${ev.t}`;
}

function renderState(state) {
  setTurnPill(state.turn);

  if (state.ended) {
    renderBanner(`Game over — winner: ${state.winner}`, true);
  } else if (state.clue?.status === "pending") {
    const hasHumanSpymaster = (state.players || []).some(
      (p) => p.team === state.turn && p.role === "SPYMASTER",
    );
    renderBanner(
      hasHumanSpymaster ? "Waiting for human spymaster clue…" : "AI spymaster is generating a clue…",
      true,
    );
  } else {
    renderBanner("", false);
  }

  const clueText =
    state.clue?.status === "ready" ? `${state.clue.clue} (${state.clue.number})` : "…";
  views.clueLabel.textContent = clueText;

  views.guessCountLabel.textContent = `${state.guesses_made_this_turn}/${state.max_guesses_this_turn}`;

  renderBoard(state);
  renderPlayers(state.players);
  renderHistory(state.history);

  // Enable/disable buttons
  const isController = player?.role === "CONTROLLER";
  const isSpymaster = player?.role === "SPYMASTER";
  const isSpectator = player?.role === "SPECTATOR" || player?.team === "SPECTATOR";
  const canActAsGuesser = !isSpymaster && !isSpectator && (player?.team === state.turn || isController);
  views.stopBtn.disabled = !(canActAsGuesser && state.clue?.status === "ready" && !state.ended);
  views.aiPlayBtn.disabled = !(canActAsGuesser && state.clue?.status === "ready" && !state.ended);
  views.aiSuggestBtn.disabled = !(state.clue?.status === "ready" && !state.ended);

  const showHumanClue =
    !state.ended &&
    state.clue?.status === "pending" &&
    player?.role === "SPYMASTER" &&
    player?.team === state.turn;
  show(views.humanClueBox, showHumanClue);
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
    const res = await apiPost(`/api/rooms/${currentRoom}/ai_guess`, { ...player });
    show(views.aiBox, true);
    const list = res.guesses || [];
    views.aiList.innerHTML = "";
    if (!list.length) {
      views.aiList.textContent = "(no guesses)";
      return;
    }
    for (const g of list) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `<div class="mono">${g.word}</div><div class="tag">${(g.confidence ?? 0).toFixed(2)}</div>`;
      views.aiList.appendChild(div);
    }
  } catch (e) {
    renderBanner(String(e?.message || e), true);
  }
}

async function aiPlayNext() {
  try {
    await apiPost(`/api/rooms/${currentRoom}/ai_play_next`, { ...player });
    await fetchAndRender(true);
  } catch (e) {
    renderBanner(String(e?.message || e), true);
  }
}

async function submitHumanClue() {
  try {
    const clue = (views.humanClueInput.value || "").trim();
    const number = parseInt(views.humanClueNumber.value || "1", 10);
    if (!clue) throw new Error("Clue required");
    await apiPost(`/api/rooms/${currentRoom}/clue`, { ...player, clue, number });
    views.humanClueInput.value = "";
    await fetchAndRender(true);
  } catch (e) {
    renderBanner(String(e?.message || e), true);
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
      await createRoom();
    } catch (e) {
      warn(String(e?.message || e));
    }
  };

  if (views.showJoinBtn) {
    views.showJoinBtn.onclick = async () => {
      try {
        await showJoinView("", "SPECTATOR", "");
      } catch (e) {
        warn(String(e?.message || e));
      }
    };
  }

  views.joinBtn.onclick = async () => {
    try {
      await joinRoom();
    } catch (e) {
      warn(String(e?.message || e));
    }
  };

  if (views.backToCreateBtn) {
    views.backToCreateBtn.onclick = () => {
      showHero(true);
      show(views.createView, true);
      show(views.joinView, false);
      show(views.gameView, false);
      history.replaceState(null, "", location.pathname);
    };
  }

  if (params.room) {
    await showJoinView(params.room, params.team || "SPECTATOR", params.role || "");
  } else {
    // show create by default
    showHero(true);
    show(views.createView, true);
    show(views.joinView, false);
    show(views.gameView, false);
  }
})();
