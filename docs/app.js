// Codenames AI - Frontend Application
import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

// API configuration - production URL with local development fallback
const API_BASE = window.CODENAMES_API_URL || 'https://codenames-ai.cschubiner.workers.dev';

// API helpers
async function api(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'API error');
  }
  return data;
}

// Format time ago
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function startAdaptivePolling(callback, visibleMs, hiddenMs) {
  let intervalId = null;

  const start = () => {
    if (intervalId) clearInterval(intervalId);
    const delay = document.hidden ? hiddenMs : visibleMs;
    intervalId = setInterval(callback, delay);
  };

  const onVisibilityChange = () => start();

  start();
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    if (intervalId) clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

// Home Screen
function Home({ onHostGame, onJoinGame, onJoinRoom }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchGames = useCallback(async () => {
    try {
      const data = await api('/api/games');
      setGames(data.games || []);
    } catch (err) {
      console.error('Failed to fetch games:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGames();
    return startAdaptivePolling(fetchGames, 5000, 30000);
  }, [fetchGames]);

  return html`
    <div class="home">
      <h1>Codenames AI</h1>
      <p>Play Codenames with AI teammates</p>
      <div class="home-buttons">
        <button class="btn btn-red" onClick=${onHostGame}>Host Game</button>
        <button class="btn btn-blue" onClick=${onJoinGame}>Join by Code</button>
      </div>

      <div class="live-games">
        <h2>Live Games</h2>
        ${loading && html`<p class="loading-text">Loading games...</p>`}
        ${!loading && games.length === 0 && html`
          <p class="no-games">No active games. Host one to get started!</p>
        `}
        ${!loading && games.length > 0 && html`
          <div class="games-list">
            ${games.map(game => html`
              <div class="game-card ${game.phase}" onClick=${() => onJoinRoom(game.roomCode)}>
                <div class="game-card-header">
                  <span class="room-code-small">${game.roomCode}</span>
                  <span class="game-phase ${game.phase}">
                    ${game.phase === 'setup' ? '⚙️ Setting Up' : '🎮 In Progress'}
                  </span>
                </div>
                <div class="game-card-body">
                  ${game.phase === 'setup' ? html`
                    <div class="game-stat">
                      <span class="stat-label">Players</span>
                      <span class="stat-value">${game.playerCount}/4</span>
                    </div>
                    <div class="game-stat">
                      <span class="stat-label">Open Roles</span>
                      <span class="stat-value highlight">${game.humanRolesNeeded > 0 ? game.humanRolesNeeded : 'None'}</span>
                    </div>
                  ` : html`
                    <div class="game-stat">
                      <span class="stat-label">Score</span>
                      <span class="stat-value">
                        <span style="color: var(--red);">🔴 ${game.redRemaining}</span>
                        ${' vs '}
                        <span style="color: var(--blue);">🔵 ${game.blueRemaining}</span>
                      </span>
                    </div>
                    <div class="game-stat">
                      <span class="stat-label">Turn</span>
                      <span class="stat-value" style="color: var(--${game.currentTeam});">
                        ${game.currentTeam.toUpperCase()}
                      </span>
                    </div>
                  `}
                </div>
                <div class="game-card-footer">
                  <span class="time-ago">${timeAgo(game.updatedAt)}</span>
                  <span class="join-hint">Click to join →</span>
                </div>
              </div>
            `)}
          </div>
        `}
      </div>
    </div>
  `;
}

// Available AI models
const AI_MODELS = [
  { id: 'gpt-5.1', name: 'GPT-5.1', description: 'Latest flagship' },
  { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Latest flagship v2' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Fast GPT-5' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Best quality' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & efficient' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Ultra fast' },
  { id: 'o3', name: 'o3', description: 'Advanced reasoning' },
  { id: 'o4-mini', name: 'o4-mini', description: 'Efficient reasoning' },
];

// Models that support reasoning_effort parameter
const REASONING_MODELS = ['gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'o3', 'o4-mini', 'o3-mini', 'o1', 'o1-mini'];

// Check if a model supports reasoning effort
function supportsReasoningEffort(modelId) {
  return REASONING_MODELS.some(m => modelId.startsWith(m));
}

// Default models for each role type
const DEFAULT_SPYMASTER_MODEL = 'gpt-4o';
const DEFAULT_GUESSER_MODEL = 'gpt-4o-mini';

// Setup Screen (Host)
function Setup({ gameState, onConfigure, onStart, onBack, error, roomCode }) {
  const [roleConfig, setRoleConfig] = useState(gameState?.roleConfig || {
    redSpymaster: 'human',
    redGuesser: 'human',
    blueSpymaster: 'human',
    blueGuesser: 'human',
  });

  const [modelConfig, setModelConfig] = useState(gameState?.modelConfig || {
    redSpymaster: DEFAULT_SPYMASTER_MODEL,
    redGuesser: DEFAULT_GUESSER_MODEL,
    blueSpymaster: DEFAULT_SPYMASTER_MODEL,
    blueGuesser: DEFAULT_GUESSER_MODEL,
  });

  const [reasoningEffortConfig, setReasoningEffortConfig] = useState(gameState?.reasoningEffortConfig || {});

  const [customInstructionsConfig, setCustomInstructionsConfig] = useState(gameState?.customInstructionsConfig || {});

  const [expandedInstructions, setExpandedInstructions] = useState({});

  const [allowHumanAIHelp, setAllowHumanAIHelp] = useState(!!gameState?.allowHumanAIHelp);

  // Sync roleConfig from server updates (e.g., when players join)
  useEffect(() => {
    if (gameState?.roleConfig) {
      setRoleConfig(gameState.roleConfig);
    }
    if (gameState?.modelConfig) {
      setModelConfig(gameState.modelConfig);
    }
    if (gameState?.reasoningEffortConfig) {
      setReasoningEffortConfig(gameState.reasoningEffortConfig);
    }
    if (gameState?.customInstructionsConfig) {
      setCustomInstructionsConfig(gameState.customInstructionsConfig);
    }
    if (typeof gameState?.allowHumanAIHelp === 'boolean') {
      setAllowHumanAIHelp(gameState.allowHumanAIHelp);
    }
  }, [gameState?.roleConfig, gameState?.modelConfig, gameState?.reasoningEffortConfig, gameState?.customInstructionsConfig, gameState?.allowHumanAIHelp]);

  const updateRole = (role, value) => {
    const newRoleConfig = { ...roleConfig, [role]: value };
    setRoleConfig(newRoleConfig);
    onConfigure({ roleConfig: newRoleConfig, modelConfig, reasoningEffortConfig, customInstructionsConfig, allowHumanAIHelp });
  };

  const updateModel = (role, model) => {
    const newModelConfig = { ...modelConfig, [role]: model };
    setModelConfig(newModelConfig);
    // Clear reasoning effort if the new model doesn't support it
    let newReasoningEffortConfig = reasoningEffortConfig;
    if (!supportsReasoningEffort(model) && reasoningEffortConfig[role]) {
      newReasoningEffortConfig = { ...reasoningEffortConfig };
      delete newReasoningEffortConfig[role];
      setReasoningEffortConfig(newReasoningEffortConfig);
    }
    onConfigure({ roleConfig, modelConfig: newModelConfig, reasoningEffortConfig: newReasoningEffortConfig, customInstructionsConfig, allowHumanAIHelp });
  };

  const updateReasoningEffort = (role, effort) => {
    const newConfig = { ...reasoningEffortConfig };
    if (effort) {
      newConfig[role] = effort;
    } else {
      delete newConfig[role];
    }
    setReasoningEffortConfig(newConfig);
    onConfigure({ roleConfig, modelConfig, reasoningEffortConfig: newConfig, customInstructionsConfig, allowHumanAIHelp });
  };

  const updateCustomInstructions = (role, instructions) => {
    const newConfig = { ...customInstructionsConfig };
    if (instructions && instructions.trim()) {
      newConfig[role] = instructions;
    } else {
      delete newConfig[role];
    }
    setCustomInstructionsConfig(newConfig);
    onConfigure({ roleConfig, modelConfig, reasoningEffortConfig, customInstructionsConfig: newConfig, allowHumanAIHelp });
  };

  const toggleInstructionsExpanded = (role) => {
    setExpandedInstructions(prev => ({ ...prev, [role]: !prev[role] }));
  };

  const updateAllowHumanAIHelp = (value) => {
    setAllowHumanAIHelp(value);
    onConfigure({ roleConfig, modelConfig, reasoningEffortConfig, customInstructionsConfig, allowHumanAIHelp: value });
  };

  const kickSeat = async (team, role) => {
    try {
      await api(`/api/games/${roomCode}/kick`, {
        method: 'POST',
        body: JSON.stringify({ team, role }),
      });
    } catch (err) {
      console.error('Kick seat error:', err);
    }
  };

  const roles = [
    { key: 'redSpymaster', label: 'Red Spymaster', team: 'red', type: 'spymaster' },
    { key: 'redGuesser', label: 'Red Guesser', team: 'red', type: 'guesser' },
    { key: 'blueSpymaster', label: 'Blue Spymaster', team: 'blue', type: 'spymaster' },
    { key: 'blueGuesser', label: 'Blue Guesser', team: 'blue', type: 'guesser' },
  ];

  // Calculate which human roles are still needed
  const missingRoles = roles
    .filter(r => roleConfig[r.key] === 'human')
    .filter(r => !gameState?.players?.some(p =>
      p.team === r.team && p.role === r.key.replace(r.team, '').toLowerCase()
    ));

  return html`
    <div class="setup container">
      <button class="btn btn-outline btn-small" onClick=${onBack}>← Back</button>

      <h2>Game Setup</h2>

      ${error && html`<div class="error">${error}</div>`}

      <div style="text-align: center; margin: 2rem 0;">
        <p>Room Code:</p>
        <div class="room-code">${gameState?.roomCode || '----'}</div>
        <p style="margin-top: 0.5rem; color: var(--text-light);">
          Share this code with other players
        </p>
      </div>

      <h3>Configure Roles</h3>
      <p style="margin-bottom: 1rem; color: var(--text-light);">
        Choose whether each role is played by a human or AI
      </p>

      <div style="margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
        <label style="display: flex; gap: 0.75rem; align-items: flex-start; cursor: pointer;">
          <input
            type="checkbox"
            checked=${allowHumanAIHelp}
            onChange=${(e) => updateAllowHumanAIHelp(e.target.checked)}
            style="margin-top: 0.2rem;"
          />
          <div>
            <div style="font-weight: 600;">Allow AI help for humans</div>
            <div style="font-size: 0.9rem; color: var(--text-light);">
              When enabled, human players can use AI clue/suggestion tools during the game.
            </div>
          </div>
        </label>
      </div>

      <div class="role-config">
        ${roles.map(role => html`
          <div class="role-item ${role.team}">
            <h4>${role.label}</h4>
            <div class="radio-toggle">
              <label class="radio-option">
                <input
                  type="radio"
                  name=${`role-${role.key}`}
                  checked=${roleConfig[role.key] === 'human'}
                  onChange=${() => updateRole(role.key, 'human')}
                />
                Human
              </label>
              <label class="radio-option">
                <input
                  type="radio"
                  name=${`role-${role.key}`}
                  checked=${roleConfig[role.key] === 'ai'}
                  onChange=${() => updateRole(role.key, 'ai')}
                />
                AI
              </label>
            </div>
            ${(() => {
              const isHumanSeat = roleConfig[role.key] === 'human';
              if (!isHumanSeat) return null;
              const occupant = gameState?.players?.find(p => p.team === role.team && p.role === role.type) || null;
              return html`
                <div style="margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;">
                  <div style="font-size: 0.9rem; color: var(--text-light);">
                    ${occupant ? html`Joined: <strong style="color: var(--text);">${occupant.name}</strong>` : 'Empty'}
                  </div>
                  <button
                    class="btn btn-outline btn-small"
                    disabled=${!occupant}
                    onClick=${() => kickSeat(role.team, role.type)}
                    title="Free this seat so the player can rejoin"
                  >
                    Reset Seat
                  </button>
                </div>
              `;
            })()}
            ${roleConfig[role.key] === 'ai' && html`
              <div style="margin-top: 0.5rem;">
                <label style="font-size: 0.8rem; color: var(--text-light);">Model:</label>
                <select
                  value=${modelConfig[role.key]}
                  onChange=${(e) => updateModel(role.key, e.target.value)}
                  style="font-size: 0.85rem; padding: 0.4rem;"
                >
                  ${AI_MODELS.map(m => html`
                    <option value=${m.id}>${m.name}</option>
                  `)}
                </select>
              </div>
              ${supportsReasoningEffort(modelConfig[role.key]) && html`
                <div style="margin-top: 0.5rem;">
                  <label style="font-size: 0.8rem; color: var(--text-light);">Reasoning Effort:</label>
                  <select
                    value=${reasoningEffortConfig[role.key] || ''}
                    onChange=${(e) => updateReasoningEffort(role.key, e.target.value || undefined)}
                    style="font-size: 0.85rem; padding: 0.4rem;"
                  >
                    <option value="">Default</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              `}
              <div style="margin-top: 0.75rem;">
                <button
                  type="button"
                  onClick=${() => toggleInstructionsExpanded(role.key)}
                  style="background: none; border: none; cursor: pointer; font-size: 0.85rem; color: var(--text-light); padding: 0; display: flex; align-items: center; gap: 0.25rem;"
                >
                  <span style="transition: transform 0.2s; transform: rotate(${expandedInstructions[role.key] ? '90deg' : '0deg'});">▶</span>
                  Additional Instructions
                  ${customInstructionsConfig[role.key] ? html`<span style="color: var(--${role.team}); font-weight: 600;"> *</span>` : ''}
                </button>
                ${expandedInstructions[role.key] && html`
                  <div style="margin-top: 0.5rem;">
                    <textarea
                      value=${customInstructionsConfig[role.key] || ''}
                      onInput=${(e) => updateCustomInstructions(role.key, e.target.value)}
                      placeholder="e.g., 'Be conservative', 'Take more risks', 'Focus on 2-word clues'..."
                      style="width: 100%; min-height: 60px; font-size: 0.85rem; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; resize: vertical;"
                    />
                  </div>
                `}
              </div>
            `}
          </div>
        `)}
      </div>

      <h3>Players Joined</h3>
      <div style="margin-bottom: 1rem;">
        ${gameState?.players?.length > 0
          ? gameState.players.map(p => html`
              <div style="padding: 0.5rem; border-bottom: 1px solid var(--border);">
                ${p.name} - ${p.team} ${p.role}
              </div>
            `)
          : html`<p style="color: var(--text-light);">No players yet</p>`
        }
      </div>

      ${missingRoles.length > 0 && html`
        <div style="margin-bottom: 1rem; padding: 1rem; background: #fff3e0; border-radius: 8px;">
          <strong>Waiting for:</strong>
          <ul style="margin: 0.5rem 0 0 1.5rem;">
            ${missingRoles.map(r => html`<li>${r.label}</li>`)}
          </ul>
        </div>
      `}

      <button class="btn btn-red" onClick=${onStart} style="width: 100%;">
        Start Game
      </button>
    </div>
  `;
}

// Join Screen
function Join({ initialRoomCode, onJoin, onBack }) {
  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookupGame = useCallback(async () => {
    if (roomCode.length !== 4) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api(`/api/games/${roomCode}`);
      setGameState(data.gameState);
    } catch (err) {
      setError(err.message);
      setGameState(null);
    }
    setLoading(false);
  }, [roomCode]);

  // Auto-lookup if we have an initial room code
  useEffect(() => {
    if (initialRoomCode && initialRoomCode.length === 4) {
      lookupGame();
    }
  }, [initialRoomCode]);

  // Poll for updates while viewing a game (to see host's role config changes)
  useEffect(() => {
    if (!gameState || roomCode.length !== 4) return;

    const poll = async () => {
      try {
        const data = await api(`/api/games/${roomCode}`);
        setGameState(data.gameState);
      } catch (err) {
        // Ignore polling errors
      }
    };

    return startAdaptivePolling(poll, 1500, 10000);
  }, [gameState, roomCode]);

  const handleJoin = async (team, role) => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    try {
      const data = await api(`/api/games/${roomCode}/join`, {
        method: 'POST',
        body: JSON.stringify({
          playerName: playerName.trim(),
          team,
          role,
        }),
      });
      onJoin(roomCode, data.player, role === 'spymaster');
    } catch (err) {
      setError(err.message);
    }
  };

  const isRoleTaken = (team, role) => {
    if (!gameState) return false;
    return gameState.players.some(p => p.team === team && p.role === role);
  };

  const isRoleAI = (team, role) => {
    if (!gameState) return false;
    // Construct key like 'redSpymaster' or 'blueGuesser'
    const key = `${team}${role.charAt(0).toUpperCase()}${role.slice(1)}`;
    const isAI = gameState.roleConfig?.[key] === 'ai';
    return isAI;
  };

  return html`
    <div class="setup container">
      <button class="btn btn-outline btn-small" onClick=${onBack}>← Back</button>

      <h2>Join Game</h2>

      <div class="form-group">
        <label>Room Code</label>
        <input
          type="text"
          value=${roomCode}
          onInput=${(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength="4"
          placeholder="ABCD"
          style="text-transform: uppercase; font-size: 1.5rem; text-align: center;"
        />
      </div>

      <button
        class="btn ${roomCode.length === 4 ? 'btn-blue' : 'btn-neutral'}"
        onClick=${lookupGame}
        disabled=${roomCode.length !== 4}
        style=${roomCode.length === 4 ? 'box-shadow: 0 4px 15px rgba(25, 118, 210, 0.4);' : 'opacity: 0.5;'}
      >
        Look Up Game
      </button>

      ${error && html`<div class="error">${error}</div>`}
      ${loading && html`<div class="loading">Loading...</div>`}

      ${gameState && html`
        <div style="margin-top: 2rem;">
          <div class="form-group">
            <label>Your Name</label>
            <input
              type="text"
              value=${playerName}
              onInput=${(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>

          <h3>Choose Your Role</h3>
          <div class="join-options">
            ${['red', 'blue'].map(team => html`
              <div class="join-card ${team}">
                <h3 style="color: var(--${team});">${team.toUpperCase()} TEAM</h3>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                  ${(() => {
                    const smIsAI = isRoleAI(team, 'spymaster');
                    const smIsTaken = isRoleTaken(team, 'spymaster');
                    const smAvailable = !smIsAI && !smIsTaken;
                    return html`
                      <button
                        class="btn btn-${team} btn-small ${!smAvailable ? 'disabled' : ''}"
                        onClick=${() => handleJoin(team, 'spymaster')}
                        disabled=${!smAvailable}
                        style=${smAvailable ? 'box-shadow: 0 0 10px var(--' + team + ');' : 'opacity: 0.5;'}
                      >
                        Spymaster ${smIsAI ? '🤖 AI' : smIsTaken ? '(Taken)' : '✓ Open'}
                      </button>
                    `;
                  })()}
                  ${(() => {
                    const gIsAI = isRoleAI(team, 'guesser');
                    const gIsTaken = isRoleTaken(team, 'guesser');
                    const gAvailable = !gIsAI && !gIsTaken;
                    return html`
                      <button
                        class="btn btn-${team} btn-small ${!gAvailable ? 'disabled' : ''}"
                        onClick=${() => handleJoin(team, 'guesser')}
                        disabled=${!gAvailable}
                        style=${gAvailable ? 'box-shadow: 0 0 10px var(--' + team + ');' : 'opacity: 0.5;'}
                      >
                        Guesser ${gIsAI ? '🤖 AI' : gIsTaken ? '(Taken)' : '✓ Open'}
                      </button>
                    `;
                  })()}
                </div>
              </div>
            `)}
          </div>
        </div>
      `}
    </div>
  `;
}

// Game Board Component
function Board({ gameState, isSpymaster, canGuess, onGuess }) {
  const { words, revealed, revealedTypes, key } = gameState;

  return html`
    <div class="board">
      ${words.map((word, i) => {
        const isRevealed = revealed[i];
        const cardType = isRevealed ? revealedTypes[i] : (isSpymaster && key ? key[i] : null);

        const classes = ['card'];
        if (isRevealed) {
          classes.push('revealed', cardType);
        } else if (isSpymaster && key) {
          classes.push('spymaster-view', key[i]);
        }
        if (!canGuess || isRevealed) {
          classes.push('disabled');
        }

        return html`
          <div
            class=${classes.join(' ')}
            onClick=${() => canGuess && !isRevealed && onGuess(word)}
          >
            ${word}
          </div>
        `;
      })}
    </div>
  `;
}

// Clue Input Component
function ClueInput({ onSubmit, team }) {
  const [word, setWord] = useState('');
  const [numberText, setNumberText] = useState('');

  const normalizedWord = word.trim();
  const parsedNumber = numberText === '' ? null : Number(numberText);
  const isValidNumber =
    Number.isInteger(parsedNumber) &&
    parsedNumber >= 0 &&
    parsedNumber <= 9;
  const canSubmit = normalizedWord.length > 0 && isValidNumber;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (canSubmit) {
      onSubmit(normalizedWord, parsedNumber);
      setWord('');
      setNumberText('');
    }
  };

  return html`
    <form class="clue-input" onSubmit=${handleSubmit}>
      <input
        type="text"
        value=${word}
        onInput=${(e) => setWord(e.target.value)}
        placeholder="Enter clue word"
      />
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        value=${numberText}
        onInput=${(e) => setNumberText(e.target.value)}
        min="0"
        max="9"
        step="1"
        placeholder="0-9"
      />
      <button
        type="submit"
        class=${`btn ${canSubmit ? `btn-${team || 'neutral'}` : 'btn-neutral'}`}
        disabled=${!canSubmit}
      >
        Give Clue
      </button>
    </form>
  `;
}

// Game Screen
function Game({ roomCode, player, isSpymaster, onLeave }) {
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showWinnerModal, setShowWinnerModal] = useState(true);

  const fetchState = useCallback(async () => {
    try {
      const data = await api(`/api/games/${roomCode}?role=${isSpymaster ? 'spymaster' : 'guesser'}&team=${player?.team}`);
      setGameState(data.gameState);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [roomCode, isSpymaster, player]);

  useEffect(() => {
    fetchState();
    return startAdaptivePolling(fetchState, 2000, 15000);
  }, [fetchState]);

  // AI state - declared early so useEffect can reference it
  const [aiClue, setAiClue] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiClueRequested, setAiClueRequested] = useState(false);
  const [aiGuessRequested, setAiGuessRequested] = useState(false);

  // Auto-trigger AI actions
  // - Always trigger AI spymaster for current team (needed for clues)
  // - Only trigger AI guesser if it's NOT your team (opponent's AI guesser)
  //   OR if you're a spymaster (you're not guessing, so AI guesser should play)
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing' || gameState.winner) return;
    if (aiLoading) return;

    const currentTeam = gameState.currentTeam;
    const spymasterKey = `${currentTeam}Spymaster`;
    const guesserKey = `${currentTeam}Guesser`;
    const isAISpymaster = gameState.roleConfig[spymasterKey] === 'ai';
    const isAIGuesser = gameState.roleConfig[guesserKey] === 'ai';

    // Determine if we should trigger the AI guesser
    // Don't trigger if: it's your team AND you're the guesser (human guesser)
    const isMyTeamsTurn = player?.team === currentTeam;
    const iAmGuesser = !isSpymaster;
    const shouldTriggerGuesser = isAIGuesser && !(isMyTeamsTurn && iAmGuesser);

    // If spymaster is AI and no clue, generate one
    if (isAISpymaster && !gameState.currentClue && !aiClueRequested) {
      setAiClueRequested(true);
      setAiLoading(true);
      console.log('Auto-triggering AI clue for', currentTeam);

      (async () => {
        try {
          await api(`/api/games/${roomCode}/ai-clue`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          await new Promise(resolve => setTimeout(resolve, 500));
          await api(`/api/games/${roomCode}/ai-clue`, {
            method: 'POST',
            body: JSON.stringify({ confirm: true }),
          });
          fetchState();
        } catch (err) {
          console.error('AI clue error:', err);
          setAiClueRequested(false);
        } finally {
          setAiLoading(false);
        }
      })();
      return;
    }

    // Reset clue requested when clue exists
    if (gameState.currentClue && aiClueRequested) {
      setAiClueRequested(false);
    }

    // If guesser is AI and we should trigger it
    if (shouldTriggerGuesser && gameState.currentClue && gameState.guessesRemaining > 0 && !aiGuessRequested) {
      setAiGuessRequested(true);
      setAiLoading(true);
      console.log('Auto-triggering AI guess for', currentTeam);

      (async () => {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const result = await api(`/api/games/${roomCode}/ai-play`, {
            method: 'POST',
          });
          console.log('AI guess result:', result);

          // Allow another guess if turn didn't end
          if (!result.result?.turnEnded && !result.result?.gameOver) {
            setAiGuessRequested(false);
          }
          fetchState();
        } catch (err) {
          console.error('AI guess error:', err);
          setAiGuessRequested(false);
        } finally {
          setAiLoading(false);
        }
      })();
      return;
    }

    // Reset guess requested when no clue or no guesses or turn changed
    if ((!gameState.currentClue || gameState.guessesRemaining <= 0) && aiGuessRequested) {
      setAiGuessRequested(false);
    }
  }, [gameState, player, isSpymaster, aiLoading, aiClueRequested, aiGuessRequested, roomCode, fetchState]);

  const handleClue = async (word, number) => {
    try {
      await api(`/api/games/${roomCode}/clue`, {
        method: 'POST',
        body: JSON.stringify({ word, number }),
      });
      fetchState();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGuess = async (word) => {
    try {
      await api(`/api/games/${roomCode}/guess`, {
        method: 'POST',
        body: JSON.stringify({ word }),
      });
      fetchState();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEndTurn = async () => {
    try {
      await api(`/api/games/${roomCode}/end-turn`, {
        method: 'POST',
      });
      fetchState();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGetAIClue = async () => {
    setAiLoading(true);
    try {
      const data = await api(`/api/games/${roomCode}/ai-clue`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setAiClue(data.clue);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setAiLoading(false);
  };

  const handleConfirmAIClue = async () => {
    setAiLoading(true);
    try {
      await api(`/api/games/${roomCode}/ai-clue`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      setAiClue(null);
      fetchState();
    } catch (err) {
      setError(err.message);
    }
    setAiLoading(false);
  };

  const handleGetAISuggestions = async () => {
    setAiLoading(true);
    try {
      const data = await api(`/api/games/${roomCode}/ai-suggest`, {
        method: 'POST',
      });
      setAiSuggestions(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setAiLoading(false);
  };

  const handleAIPlay = async () => {
    setAiLoading(true);
    try {
      await api(`/api/games/${roomCode}/ai-play`, {
        method: 'POST',
      });
      setAiSuggestions(null);
      fetchState();
    } catch (err) {
      setError(err.message);
    }
    setAiLoading(false);
  };

  if (loading) {
    return html`<div class="loading">Loading game...</div>`;
  }

  if (!gameState) {
    return html`
      <div class="container">
        <div class="error">${error || 'Game not found'}</div>
        <button class="btn btn-outline" onClick=${onLeave}>Back to Home</button>
      </div>
    `;
  }

  const { currentTeam, currentClue, guessesRemaining, redRemaining, blueRemaining, winner, phase } = gameState;
  const canUseAIHints = !!gameState.allowHumanAIHelp;

  const isMyTurn = player?.team === currentTeam;
  const isMySpymasterTurn = isSpymaster && isMyTurn && !currentClue;
  const isMyGuesserTurn = !isSpymaster && isMyTurn && currentClue && guessesRemaining > 0;

  return html`
    <div>
      <div class="header">
        <h1>Codenames AI</h1>
        <div>Room: ${roomCode} | You: ${player?.name} (${player?.team} ${isSpymaster ? 'Spymaster' : 'Guesser'})</div>
      </div>

      ${error && html`<div class="error">${error}</div>`}

      ${winner && showWinnerModal && html`
        <div class="winner-overlay" onClick=${() => setShowWinnerModal(false)}>
          <div class="winner-modal ${winner}" onClick=${(e) => e.stopPropagation()}>
            <button class="modal-close" onClick=${() => setShowWinnerModal(false)}>✕</button>
            <h2>${winner.toUpperCase()} WINS!</h2>
            <div class="winner-actions">
              <button class="btn btn-outline" onClick=${() => setShowWinnerModal(false)}>View Board</button>
              <button class="btn btn-blue" onClick=${onLeave}>Back to Home</button>
            </div>
          </div>
        </div>
      `}

      ${winner && !showWinnerModal && html`
        <div class="winner-banner ${winner}">
          <span>${winner.toUpperCase()} WINS!</span>
          <button class="btn btn-outline btn-small" onClick=${onLeave}>Back to Home</button>
        </div>
      `}

      <div class="game-info">
        <div class="team-score red">
          🔴 ${redRemaining}
        </div>
        <div class="current-turn">
          <div class="turn-indicator ${currentTeam}">
            ${currentTeam.toUpperCase()}'s Turn
          </div>
        </div>
        <div class="team-score blue">
          🔵 ${blueRemaining}
        </div>
      </div>

      ${aiLoading && html`
        <div style="text-align: center; margin: 1rem 0; padding: 0.75rem; background: #e3f2fd; border-radius: 8px; animation: pulse 1.5s ease-in-out infinite;">
          <span>AI is thinking...</span>
        </div>
      `}

      ${currentClue && html`
        <div class="clue-display">
          <div class="clue-word">${currentClue.word}</div>
          <div class="clue-number">${currentClue.number}</div>
          <div class="guesses-remaining">${guessesRemaining} guesses left</div>
        </div>
      `}

      ${isMySpymasterTurn && html`
        <div style="text-align: center; margin: 1rem 0;">
          <p>It's your turn! Give a clue to your team.</p>
          <${ClueInput} onSubmit=${handleClue} team=${currentTeam} />
          ${canUseAIHints && html`
            <div style="margin-top: 1rem;">
              <button
                class="btn btn-neutral btn-small"
                onClick=${handleGetAIClue}
                disabled=${aiLoading}
              >
                ${aiLoading ? 'Thinking...' : 'Get AI Suggestion'}
              </button>
            </div>
            ${aiClue && html`
              <div style="margin-top: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
                <p><strong>AI suggests:</strong> ${aiClue.clue} ${aiClue.number}</p>
                <p style="font-size: 0.9rem; color: #666;">Targets: ${aiClue.intendedTargets?.join(', ')}</p>
                <p style="font-size: 0.8rem; color: #888;">${aiClue.reasoning}</p>
                <button class="btn btn-red btn-small" onClick=${handleConfirmAIClue}>
                  Use This Clue
                </button>
              </div>
            `}
          `}
        </div>
      `}

      ${!currentClue && isMyTurn && !isSpymaster && html`
        <div style="text-align: center; margin: 1rem 0; padding: 1rem; background: #fff3e0; border-radius: 8px;">
          <p>Waiting for ${currentTeam} spymaster to give a clue...</p>
          ${canUseAIHints && html`
            <button
              class="btn btn-neutral btn-small"
              onClick=${handleGetAIClue}
              disabled=${aiLoading}
            >
              ${aiLoading ? 'Generating...' : 'Generate AI Clue'}
            </button>
            ${aiClue && html`
              <div style="margin-top: 1rem;">
                <p><strong>AI suggests:</strong> ${aiClue.clue} ${aiClue.number}</p>
                <button class="btn btn-red btn-small" onClick=${handleConfirmAIClue}>
                  Submit AI Clue
                </button>
              </div>
            `}
          `}
        </div>
      `}

      <${Board}
        gameState=${gameState}
        isSpymaster=${isSpymaster}
        canGuess=${isMyGuesserTurn}
        onGuess=${handleGuess}
      />

      ${isMyGuesserTurn && html`
        <div class="actions">
          <button class="btn btn-outline" onClick=${handleEndTurn}>
            End Turn
          </button>
          ${canUseAIHints && html`
            <button
              class="btn btn-neutral"
              onClick=${handleGetAISuggestions}
              disabled=${aiLoading}
            >
              ${aiLoading ? 'Thinking...' : 'AI Suggest'}
            </button>
            <button
              class="btn btn-blue"
              onClick=${handleAIPlay}
              disabled=${aiLoading}
            >
              ${aiLoading ? 'Playing...' : 'AI Play'}
            </button>
          `}
        </div>
        ${canUseAIHints && aiSuggestions && html`
          <div style="max-width: 400px; margin: 1rem auto; padding: 1rem; background: #e3f2fd; border-radius: 8px;">
            <h4>AI Suggestions:</h4>
            ${aiSuggestions.suggestions?.slice(0, 5).map((s, i) => html`
              <div
                style="display: flex; justify-content: space-between; padding: 0.5rem; cursor: pointer; border-radius: 4px; ${i === 0 ? 'background: #bbdefb;' : ''}"
                onClick=${() => handleGuess(s.word)}
              >
                <span>${s.word}</span>
                <span style="color: #666;">${Math.round(s.confidence * 100)}%</span>
              </div>
            `)}
            <p style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">
              ${aiSuggestions.reasoning}
            </p>
            <p style="font-size: 0.8rem; color: #888;">
              Recommended: stop after ${aiSuggestions.stopAfter || 'all'} guesses
            </p>
          </div>
        `}
      `}

      <div class="history">
        <h3>Clue History</h3>
        ${gameState.clueHistory.map(clue => {
          // Get the AI reasoning from the first guess that has it (they share the same reasoning)
          const aiReasoning = clue.guesses?.find(g => g.aiReasoning)?.aiReasoning;
          return html`
            <div class="history-item">
              <div class="history-row">
                <span class="team-badge ${clue.team}">${clue.team}</span>
                <strong>${clue.word}</strong> ${clue.number}
              </div>
              ${clue.guesses?.length ? html`
                <div class="history-guesses">
                  ${clue.guesses.map(g => html`
                    <span class="guess-chip ${g.cardType}">${g.word}</span>
                  `)}
                </div>
              ` : null}
              ${aiReasoning ? html`
                <div class="ai-reasoning" style="margin-top: 0.5rem; padding: 0.5rem; background: #f5f5f5; border-radius: 4px; font-size: 0.8rem; color: #666;">
                  <strong>AI reasoning:</strong> ${aiReasoning}
                </div>
              ` : null}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// Host View (TV Screen)
function HostView({ roomCode, onLeave }) {
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiActionPending, setAiActionPending] = useState(false);
  const [showWinnerModal, setShowWinnerModal] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const data = await api(`/api/games/${roomCode}`);
      setGameState(data.gameState);
    } catch (err) {
      setError(err.message);
    }
  }, [roomCode]);

  useEffect(() => {
    fetchState();
    return startAdaptivePolling(fetchState, 2000, 15000);
  }, [fetchState]);

  const kickSeat = async (team, role) => {
    try {
      await api(`/api/games/${roomCode}/kick`, {
        method: 'POST',
        body: JSON.stringify({ team, role }),
      });
      fetchState();
    } catch (err) {
      console.error('Kick seat error:', err);
    }
  };

  // Auto-trigger AI actions for host view
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing' || gameState.winner) return;
    if (aiLoading || aiActionPending) return;

    const currentTeam = gameState.currentTeam;
    const spymasterKey = `${currentTeam}Spymaster`;
    const guesserKey = `${currentTeam}Guesser`;
    const isAISpymaster = gameState.roleConfig[spymasterKey] === 'ai';
    const isAIGuesser = gameState.roleConfig[guesserKey] === 'ai';

    // If spymaster is AI and no clue, generate one
    if (isAISpymaster && !gameState.currentClue) {
      setAiActionPending(true);
      setAiLoading(true);
      console.log('Host: Auto-triggering AI clue for', currentTeam);

      (async () => {
        try {
          await api(`/api/games/${roomCode}/ai-clue`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          await new Promise(resolve => setTimeout(resolve, 500));
          await api(`/api/games/${roomCode}/ai-clue`, {
            method: 'POST',
            body: JSON.stringify({ confirm: true }),
          });
          fetchState();
        } catch (err) {
          console.error('AI clue error:', err);
        } finally {
          setAiLoading(false);
          setAiActionPending(false);
        }
      })();
      return;
    }

    // If guesser is AI and there's a clue with guesses remaining, make a guess
    if (isAIGuesser && gameState.currentClue && gameState.guessesRemaining > 0) {
      setAiActionPending(true);
      setAiLoading(true);
      console.log('Host: Auto-triggering AI guess for', currentTeam);

      (async () => {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const result = await api(`/api/games/${roomCode}/ai-play`, {
            method: 'POST',
          });
          console.log('AI guess result:', result);
          fetchState();
        } catch (err) {
          console.error('AI guess error:', err);
        } finally {
          setAiLoading(false);
          // Small delay before allowing next action
          setTimeout(() => setAiActionPending(false), 500);
        }
      })();
    }
  }, [gameState, aiLoading, aiActionPending, roomCode, fetchState]);

  if (!gameState) {
    return html`<div class="loading">Loading...</div>`;
  }

  const { currentTeam, currentClue, guessesRemaining, redRemaining, blueRemaining, winner } = gameState;

  return html`
    <div class="host-view">
      <div class="header">
        <h1>Codenames AI</h1>
        <div style="font-size: 2rem;">Room: <strong>${roomCode}</strong></div>
        <div style="margin-top: 0.75rem;">
          <button class="btn btn-outline btn-small" onClick=${() => setShowAdmin(!showAdmin)}>
            ${showAdmin ? 'Hide Admin' : 'Show Admin'}
          </button>
        </div>
      </div>

      ${showAdmin && html`
        <div style="max-width: 900px; margin: 1rem auto; padding: 1rem; background: rgba(255,255,255,0.92); border: 2px solid var(--border); border-radius: 12px;">
          <h3 style="margin: 0 0 0.75rem 0;">Reset Seats</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            ${[
              { team: 'red', role: 'spymaster', label: 'Red Spymaster' },
              { team: 'red', role: 'guesser', label: 'Red Guesser' },
              { team: 'blue', role: 'spymaster', label: 'Blue Spymaster' },
              { team: 'blue', role: 'guesser', label: 'Blue Guesser' },
            ].map(seat => {
              const roleKey = `${seat.team}${seat.role.charAt(0).toUpperCase()}${seat.role.slice(1)}`;
              if (gameState.roleConfig?.[roleKey] !== 'human') return null;
              const occupant = gameState.players?.find(p => p.team === seat.team && p.role === seat.role);
              return html`
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 10px;">
                  <div>
                    <div style="font-weight: 700; color: var(--${seat.team});">${seat.label}</div>
                    <div style="color: var(--text-light); font-size: 0.95rem;">
                      ${occupant ? `Joined: ${occupant.name}` : 'Empty'}
                    </div>
                  </div>
                  <button
                    class="btn btn-outline btn-small"
                    disabled=${!occupant}
                    onClick=${() => kickSeat(seat.team, seat.role)}
                  >
                    Reset Seat
                  </button>
                </div>
              `;
            })}
          </div>
        </div>
      `}

      ${winner && showWinnerModal && html`
        <div class="winner-overlay" onClick=${() => setShowWinnerModal(false)}>
          <div class="winner-modal ${winner}" onClick=${(e) => e.stopPropagation()}>
            <button class="modal-close" onClick=${() => setShowWinnerModal(false)}>✕</button>
            <h2>${winner.toUpperCase()} WINS!</h2>
            <div class="winner-actions">
              <button class="btn btn-outline" onClick=${() => setShowWinnerModal(false)}>View Board</button>
              <button class="btn btn-blue" onClick=${onLeave}>New Game</button>
            </div>
          </div>
        </div>
      `}

      ${winner && !showWinnerModal && html`
        <div class="winner-banner ${winner}">
          <span>${winner.toUpperCase()} WINS!</span>
          <button class="btn btn-outline btn-small" onClick=${onLeave}>New Game</button>
        </div>
      `}

      <div class="game-info" style="font-size: 1.5rem;">
        <div class="team-score red">
          🔴 ${redRemaining}
        </div>
        <div class="current-turn">
          <div class="turn-indicator ${currentTeam}" style="font-size: 1.5rem; padding: 1rem 2rem;">
            ${winner ? 'Game Over' : currentTeam.toUpperCase() + "'s Turn"}
          </div>
        </div>
        <div class="team-score blue">
          🔵 ${blueRemaining}
        </div>
      </div>

      ${aiLoading && html`
        <div style="text-align: center; margin: 1rem 0; padding: 1rem; background: #e3f2fd; border-radius: 8px; font-size: 1.5rem; animation: pulse 1.5s ease-in-out infinite;">
          AI is thinking...
        </div>
      `}

      ${currentClue && html`
        <div class="clue-display" style="font-size: 1.5rem;">
          <div class="clue-word" style="font-size: 3rem;">${currentClue.word}</div>
          <div class="clue-number" style="font-size: 2rem;">${currentClue.number}</div>
        </div>
      `}

      <${Board}
        gameState=${gameState}
        isSpymaster=${false}
        canGuess=${false}
        onGuess=${() => {}}
      />
    </div>
  `;
}

// Main App Component
function App() {
  const [screen, setScreen] = useState('home');
  const [roomCode, setRoomCode] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [player, setPlayer] = useState(null);
  const [isSpymaster, setIsSpymaster] = useState(false);
  const [error, setError] = useState(null);

  // Poll for game state updates during setup (to see player joins)
  useEffect(() => {
    if (screen !== 'setup' || !roomCode) return;

    const pollState = async () => {
      try {
        const data = await api(`/api/games/${roomCode}`);
        setGameState(data.gameState);
      } catch (err) {
        console.error('Poll error:', err);
      }
    };

    pollState();
    return startAdaptivePolling(pollState, 2000, 15000);
  }, [screen, roomCode]);

  const handleHostGame = async () => {
    try {
      const data = await api('/api/games', { method: 'POST' });
      setRoomCode(data.roomCode);
      setGameState(data.gameState);
      setScreen('setup');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfigure = async (config) => {
    try {
      const data = await api(`/api/games/${roomCode}/configure`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
      setGameState(data.gameState);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartGame = async () => {
    try {
      const data = await api(`/api/games/${roomCode}/start`, {
        method: 'POST',
      });
      setGameState(data.gameState);
      setScreen('host');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleJoinGame = (code, playerData, spymaster) => {
    setRoomCode(code);
    setPlayer(playerData);
    setIsSpymaster(spymaster);
    setScreen('game');
  };

  const handleBack = () => {
    setScreen('home');
    setRoomCode(null);
    setGameState(null);
    setPlayer(null);
    setError(null);
  };

  // Handle clicking a game from the list - go directly to join with code pre-filled
  const handleJoinRoom = (code) => {
    setRoomCode(code);
    setScreen('join');
  };

  return html`
    ${screen === 'home' && html`
      <${Home}
        onHostGame=${handleHostGame}
        onJoinGame=${() => setScreen('join')}
        onJoinRoom=${handleJoinRoom}
      />
    `}
    ${screen === 'setup' && html`
      <${Setup}
        gameState=${gameState}
        roomCode=${roomCode}
        onConfigure=${handleConfigure}
        onStart=${handleStartGame}
        onBack=${handleBack}
        error=${error}
      />
    `}
    ${screen === 'join' && html`
      <${Join}
        initialRoomCode=${roomCode}
        onJoin=${handleJoinGame}
        onBack=${handleBack}
      />
    `}
    ${screen === 'game' && html`
      <${Game}
        roomCode=${roomCode}
        player=${player}
        isSpymaster=${isSpymaster}
        onLeave=${handleBack}
      />
    `}
    ${screen === 'host' && html`
      <${HostView}
        roomCode=${roomCode}
        onLeave=${handleBack}
      />
    `}
    ${error && screen === 'home' && html`
      <div class="container">
        <div class="error">${error}</div>
      </div>
    `}
  `;
}

// Mount the app
render(html`<${App} />`, document.getElementById('app'));
