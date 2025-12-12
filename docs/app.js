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

// Home Screen
function Home({ onHostGame, onJoinGame }) {
  return html`
    <div class="home">
      <h1>Codenames AI</h1>
      <p>Play Codenames with AI teammates</p>
      <div class="home-buttons">
        <button class="btn btn-red" onClick=${onHostGame}>Host Game</button>
        <button class="btn btn-blue" onClick=${onJoinGame}>Join Game</button>
      </div>
    </div>
  `;
}

// Available AI models
const AI_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Best quality' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & efficient' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Ultra fast' },
  { id: 'o3', name: 'o3', description: 'Advanced reasoning' },
  { id: 'o4-mini', name: 'o4-mini', description: 'Efficient reasoning' },
];

// Default models for each role type
const DEFAULT_SPYMASTER_MODEL = 'gpt-4o';
const DEFAULT_GUESSER_MODEL = 'gpt-4o-mini';

// Setup Screen (Host)
function Setup({ gameState, onConfigure, onStart, onBack, error }) {
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

  const updateRole = (role, value) => {
    const newRoleConfig = { ...roleConfig, [role]: value };
    setRoleConfig(newRoleConfig);
    onConfigure({ roleConfig: newRoleConfig, modelConfig });
  };

  const updateModel = (role, model) => {
    const newModelConfig = { ...modelConfig, [role]: model };
    setModelConfig(newModelConfig);
    onConfigure({ roleConfig, modelConfig: newModelConfig });
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

      <div class="role-config">
        ${roles.map(role => html`
          <div class="role-item ${role.team}">
            <h4>${role.label}</h4>
            <select
              value=${roleConfig[role.key]}
              onChange=${(e) => updateRole(role.key, e.target.value)}
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
            </select>
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
function Join({ onJoin, onBack }) {
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookupGame = async () => {
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
  };

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
    const key = `${team}${role.charAt(0).toUpperCase()}${role.slice(1)}`;
    return gameState.roleConfig[key] === 'ai';
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

      <button class="btn btn-neutral" onClick=${lookupGame} disabled=${roomCode.length !== 4}>
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
                  <button
                    class="btn btn-${team} btn-small ${isRoleTaken(team, 'spymaster') || isRoleAI(team, 'spymaster') ? 'disabled' : ''}"
                    onClick=${() => handleJoin(team, 'spymaster')}
                    disabled=${isRoleTaken(team, 'spymaster') || isRoleAI(team, 'spymaster')}
                  >
                    Spymaster ${isRoleAI(team, 'spymaster') ? '(AI)' : isRoleTaken(team, 'spymaster') ? '(Taken)' : ''}
                  </button>
                  <button
                    class="btn btn-${team} btn-small ${isRoleTaken(team, 'guesser') || isRoleAI(team, 'guesser') ? 'disabled' : ''}"
                    onClick=${() => handleJoin(team, 'guesser')}
                    disabled=${isRoleTaken(team, 'guesser') || isRoleAI(team, 'guesser')}
                  >
                    Guesser ${isRoleAI(team, 'guesser') ? '(AI)' : isRoleTaken(team, 'guesser') ? '(Taken)' : ''}
                  </button>
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
function ClueInput({ onSubmit }) {
  const [word, setWord] = useState('');
  const [number, setNumber] = useState(1);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (word.trim()) {
      onSubmit(word.trim(), number);
      setWord('');
      setNumber(1);
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
        value=${number}
        onInput=${(e) => setNumber(parseInt(e.target.value) || 1)}
        min="1"
        max="9"
      />
      <button type="submit" class="btn btn-neutral">Give Clue</button>
    </form>
  `;
}

// Game Screen
function Game({ roomCode, player, isSpymaster, onLeave }) {
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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
    const interval = setInterval(fetchState, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
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

      ${winner && html`
        <div class="winner-overlay">
          <div class="winner-modal ${winner}">
            <h2>${winner.toUpperCase()} WINS!</h2>
            <button class="btn btn-outline" onClick=${onLeave}>Back to Home</button>
          </div>
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
          <div class="clue-number">${currentClue.number} (${guessesRemaining} guesses left)</div>
        </div>
      `}

      ${isMySpymasterTurn && html`
        <div style="text-align: center; margin: 1rem 0;">
          <p>It's your turn! Give a clue to your team.</p>
          <${ClueInput} onSubmit=${handleClue} />
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
        </div>
      `}

      ${!currentClue && isMyTurn && !isSpymaster && html`
        <div style="text-align: center; margin: 1rem 0; padding: 1rem; background: #fff3e0; border-radius: 8px;">
          <p>Waiting for ${currentTeam} spymaster to give a clue...</p>
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
        </div>
        ${aiSuggestions && html`
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
        ${gameState.clueHistory.map(clue => html`
          <div class="history-item">
            <span class="team-badge ${clue.team}">${clue.team}</span>
            <strong>${clue.word}</strong> ${clue.number}
          </div>
        `)}
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
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [fetchState]);

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
      </div>

      ${winner && html`
        <div class="winner-overlay">
          <div class="winner-modal ${winner}">
            <h2>${winner.toUpperCase()} WINS!</h2>
            <button class="btn btn-outline" onClick=${onLeave}>New Game</button>
          </div>
        </div>
      `}

      <div class="game-info" style="font-size: 1.5rem;">
        <div class="team-score red">
          🔴 ${redRemaining}
        </div>
        <div class="current-turn">
          <div class="turn-indicator ${currentTeam}" style="font-size: 1.5rem; padding: 1rem 2rem;">
            ${currentTeam.toUpperCase()}'s Turn
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

  const handleConfigure = async (roleConfig) => {
    try {
      const data = await api(`/api/games/${roomCode}/configure`, {
        method: 'POST',
        body: JSON.stringify({ roleConfig }),
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

  return html`
    ${screen === 'home' && html`
      <${Home}
        onHostGame=${handleHostGame}
        onJoinGame=${() => setScreen('join')}
      />
    `}
    ${screen === 'setup' && html`
      <${Setup}
        gameState=${gameState}
        onConfigure=${handleConfigure}
        onStart=${handleStartGame}
        onBack=${handleBack}
        error=${error}
      />
    `}
    ${screen === 'join' && html`
      <${Join}
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
