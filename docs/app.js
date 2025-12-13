// Codenames AI - Frontend Application
import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useCallback, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

// API configuration - production URL with local development fallback
const API_BASE = window.CODENAMES_API_URL || 'https://codenames-ai.cschubiner.workers.dev';

// Presets (local to this browser/device)
const PRESETS_STORAGE_KEY = 'codenames.presets.v1';
function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function persistPresets(presets) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage failures (private mode, etc.)
  }
}

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

      <${GameHistory} />
    </div>
  `;
}

// Format duration in human-readable form
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Format milliseconds as mm:ss
function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Live timer component that updates every second
function LiveTimer({ phaseStartTime, accumulatedMs, isPaused }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!phaseStartTime || isPaused) {
      // When paused, don't reset - just stop updating
      if (!isPaused) {
        setElapsed(0);
      }
      return;
    }

    const update = () => {
      setElapsed(Date.now() - phaseStartTime);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [phaseStartTime, isPaused]);

  const total = (accumulatedMs || 0) + elapsed;
  return html`<span>${formatMs(total)}</span>`;
}

// Turn timer countdown component with auto-end-turn
function TurnTimerCountdown({ turnStartTime, turnTimer, onTimeUp, isActive, isPaused }) {
  const [remaining, setRemaining] = useState(turnTimer ? turnTimer * 1000 : 0);
  const [hasTriggered, setHasTriggered] = useState(false);

  useEffect(() => {
    // Reset triggered state when turn changes
    setHasTriggered(false);
  }, [turnStartTime]);

  useEffect(() => {
    if (!turnTimer || !turnStartTime || !isActive || isPaused) {
      // Don't reset remaining when paused - just stop updating
      if (!isPaused) {
        setRemaining(turnTimer ? turnTimer * 1000 : 0);
      }
      return;
    }

    const update = () => {
      const elapsed = Date.now() - turnStartTime;
      const left = Math.max(0, (turnTimer * 1000) - elapsed);
      setRemaining(left);

      // Auto-end turn when timer hits 0
      if (left === 0 && !hasTriggered && onTimeUp) {
        setHasTriggered(true);
        onTimeUp();
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [turnStartTime, turnTimer, isActive, isPaused, hasTriggered, onTimeUp]);

  if (!turnTimer) return null;

  const totalMs = turnTimer * 1000;
  const percent = (remaining / totalMs) * 100;
  const isLow = remaining <= 10000; // Last 10 seconds
  const isWarning = remaining <= 30000 && remaining > 10000; // 10-30 seconds

  return html`
    <div class="turn-timer-countdown ${isLow ? 'low' : isWarning ? 'warning' : ''} ${isPaused ? 'paused' : ''}">
      <div class="timer-bar-container">
        <div class="timer-bar" style="width: ${percent}%"></div>
      </div>
      <div class="timer-text">${isPaused ? 'PAUSED' : formatMs(remaining)}</div>
    </div>
  `;
}

// Timing display for host view showing all team times
function TimingDisplay({ gameState }) {
  const { timing, phaseStartTime, turnPhase, currentTeam, phase, isPaused } = gameState;

  if (!timing || phase === 'setup') return null;

  // Determine which timer is currently active (but not when paused)
  const isRedSpymasterActive = phase === 'playing' && currentTeam === 'red' && turnPhase === 'clue' && !isPaused;
  const isRedGuesserActive = phase === 'playing' && currentTeam === 'red' && turnPhase === 'guess' && !isPaused;
  const isBlueSpymasterActive = phase === 'playing' && currentTeam === 'blue' && turnPhase === 'clue' && !isPaused;
  const isBlueGuesserActive = phase === 'playing' && currentTeam === 'blue' && turnPhase === 'guess' && !isPaused;

  return html`
    <div class="timing-display ${isPaused ? 'paused' : ''}">
      <div class="timing-team red">
        <div class="timing-team-label">RED</div>
        <div class="timing-row ${isRedSpymasterActive ? 'active' : ''}">
          <span class="timing-label">Spymaster:</span>
          <span class="timing-value">
            ${isRedSpymasterActive
              ? html`<${LiveTimer} phaseStartTime=${phaseStartTime} accumulatedMs=${timing.red.spymasterMs} isPaused=${isPaused} />`
              : formatMs(timing.red.spymasterMs)
            }
          </span>
        </div>
        <div class="timing-row ${isRedGuesserActive ? 'active' : ''}">
          <span class="timing-label">Guesser:</span>
          <span class="timing-value">
            ${isRedGuesserActive
              ? html`<${LiveTimer} phaseStartTime=${phaseStartTime} accumulatedMs=${timing.red.guesserMs} isPaused=${isPaused} />`
              : formatMs(timing.red.guesserMs)
            }
          </span>
        </div>
        <div class="timing-row total">
          <span class="timing-label">Total:</span>
          <span class="timing-value">
            ${(isRedSpymasterActive || isRedGuesserActive)
              ? html`<${LiveTimer} phaseStartTime=${phaseStartTime} accumulatedMs=${timing.red.spymasterMs + timing.red.guesserMs} isPaused=${isPaused} />`
              : formatMs(timing.red.spymasterMs + timing.red.guesserMs)
            }
          </span>
        </div>
      </div>
      <div class="timing-team blue">
        <div class="timing-team-label">BLUE</div>
        <div class="timing-row ${isBlueSpymasterActive ? 'active' : ''}">
          <span class="timing-label">Spymaster:</span>
          <span class="timing-value">
            ${isBlueSpymasterActive
              ? html`<${LiveTimer} phaseStartTime=${phaseStartTime} accumulatedMs=${timing.blue.spymasterMs} isPaused=${isPaused} />`
              : formatMs(timing.blue.spymasterMs)
            }
          </span>
        </div>
        <div class="timing-row ${isBlueGuesserActive ? 'active' : ''}">
          <span class="timing-label">Guesser:</span>
          <span class="timing-value">
            ${isBlueGuesserActive
              ? html`<${LiveTimer} phaseStartTime=${phaseStartTime} accumulatedMs=${timing.blue.guesserMs} isPaused=${isPaused} />`
              : formatMs(timing.blue.guesserMs)
            }
          </span>
        </div>
        <div class="timing-row total">
          <span class="timing-label">Total:</span>
          <span class="timing-value">
            ${(isBlueSpymasterActive || isBlueGuesserActive)
              ? html`<${LiveTimer} phaseStartTime=${phaseStartTime} accumulatedMs=${timing.blue.spymasterMs + timing.blue.guesserMs} isPaused=${isPaused} />`
              : formatMs(timing.blue.spymasterMs + timing.blue.guesserMs)
            }
          </span>
        </div>
      </div>
    </div>
  `;
}

// Format date for display
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else if (isYesterday) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

// Game History Component
function GameHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const data = await api('/api/history?limit=20');
        setHistory(data.games || []);
      } catch (err) {
        console.error('Failed to fetch game history:', err);
      }
      setLoading(false);
    }
    fetchHistory();
  }, []);

  // Get a concise model list for display (handles both legacy single model and new multi-model)
  const getModelList = (roleConfig) => {
    if (!roleConfig) return [];
    if (roleConfig.type === 'human') return ['Human'];

    // Check for new multi-model array
    if (roleConfig.models && Array.isArray(roleConfig.models) && roleConfig.models.length > 0) {
      return roleConfig.models.map(m => m.model);
    }

    // Fall back to legacy single model
    if (roleConfig.model) {
      return [roleConfig.model];
    }

    return ['AI'];
  };

  // Format model list for display (compact)
  const formatModelList = (models) => {
    if (models.length === 0) return '?';
    if (models.length === 1) return models[0];
    // For multiple models, show count
    const uniqueModels = [...new Set(models)];
    if (uniqueModels.length === 1) return `${uniqueModels[0]} (×${models.length})`;
    return `${uniqueModels.length} models`;
  };

  // Get team summary for top-level display (concise)
  const getTeamSummary = (config) => {
    const smModels = getModelList(config?.spymaster);
    const gModels = getModelList(config?.guesser);

    const smDisplay = smModels[0] === 'Human' ? 'Human' : formatModelList(smModels);
    const gDisplay = gModels[0] === 'Human' ? 'Human' : formatModelList(gModels);

    return { spymaster: smDisplay, guesser: gDisplay };
  };

  // Get detailed model display for expanded view
  const getDetailedModelDisplay = (roleConfig, roleName) => {
    if (!roleConfig) return html`<span>${roleName}: Unknown</span>`;
    if (roleConfig.type === 'human') return html`<span>${roleName}: Human</span>`;

    const models = roleConfig.models && Array.isArray(roleConfig.models) && roleConfig.models.length > 0
      ? roleConfig.models
      : roleConfig.model ? [{ model: roleConfig.model, reasoningEffort: roleConfig.reasoning }] : [];

    if (models.length === 0) return html`<span>${roleName}: AI</span>`;

    if (models.length === 1) {
      const m = models[0];
      return html`<span>${roleName}: ${m.model}${m.reasoningEffort ? ` (${m.reasoningEffort})` : ''}</span>`;
    }

    // Multiple models
    return html`
      <div>
        <span>${roleName}: ${models.length} models</span>
        <ul style="margin: 0.25rem 0 0 1rem; padding: 0; list-style: disc;">
          ${models.map(m => html`
            <li style="font-size: 0.85em;">${m.model}${m.reasoningEffort ? ` (${m.reasoningEffort})` : ''}</li>
          `)}
        </ul>
      </div>
    `;
  };

  const getEndReasonDisplay = (reason, winner) => {
    switch (reason) {
      case 'assassin': return '💀 Assassin hit';
      case 'all_found': return `${winner === 'red' ? '🔴' : '🔵'} Found all words`;
      case 'opponent_found_all': return `${winner === 'red' ? '🔴' : '🔵'} Opponent helped`;
      default: return reason;
    }
  };

  if (loading) {
    return html`<div class="game-history"><h2>Game History</h2><p class="loading-text">Loading history...</p></div>`;
  }

  if (history.length === 0) {
    return html`<div class="game-history"><h2>Game History</h2><p class="no-games">No completed games yet.</p></div>`;
  }

  return html`
    <div class="game-history">
      <h2>Game History</h2>
      <div class="history-list">
        ${history.map((game, idx) => {
          const redSummary = getTeamSummary(game.redConfig);
          const blueSummary = getTeamSummary(game.blueConfig);

          return html`
            <div
              class="history-card ${game.winner}"
              onClick=${() => setExpanded(expanded === idx ? null : idx)}
            >
              <div class="history-header">
                <span class="winner-badge ${game.winner}">
                  ${game.winner === 'red' ? '🔴 RED' : '🔵 BLUE'} WINS
                </span>
                <span class="history-date">${formatDate(game.finishedAt)}</span>
              </div>

              <div class="history-matchup">
                <div class="matchup-team red">
                  <div class="matchup-label">🔴 Red</div>
                  <div class="matchup-models">
                    <span class="model-role">SM:</span> <span class="model-name">${redSummary.spymaster}</span>
                  </div>
                  <div class="matchup-models">
                    <span class="model-role">G:</span> <span class="model-name">${redSummary.guesser}</span>
                  </div>
                </div>
                <div class="matchup-vs">vs</div>
                <div class="matchup-team blue">
                  <div class="matchup-label">🔵 Blue</div>
                  <div class="matchup-models">
                    <span class="model-role">SM:</span> <span class="model-name">${blueSummary.spymaster}</span>
                  </div>
                  <div class="matchup-models">
                    <span class="model-role">G:</span> <span class="model-name">${blueSummary.guesser}</span>
                  </div>
                </div>
              </div>

              <div class="history-summary">
                <div class="history-score">
                  <span class="score-team red">${9 - game.redFinalScore}</span>
                  <span class="score-divider">-</span>
                  <span class="score-team blue">${8 - game.blueFinalScore}</span>
                  <span class="score-label">found</span>
                </div>
                <div class="history-stats-brief">
                  <span>${game.totalTurns} turns</span>
                  <span>${formatDuration(game.durationSeconds)}</span>
                </div>
              </div>

              ${expanded === idx && html`
                <div class="history-details">
                  <div class="team-details red">
                    <h4>🔴 Red Team</h4>
                    <div class="detail-row">
                      ${getDetailedModelDisplay(game.redConfig?.spymaster, 'Spymaster')}
                    </div>
                    <div class="detail-row">
                      ${getDetailedModelDisplay(game.redConfig?.guesser, 'Guesser')}
                    </div>
                    ${game.redPlayers.length > 0 && html`
                      <div class="detail-row">
                        <span class="detail-label">Players:</span>
                        <span class="detail-value">${game.redPlayers.join(', ')}</span>
                      </div>
                    `}
                    <div class="detail-row">
                      <span class="detail-label">Clues:</span>
                      <span class="detail-value">
                        ${game.redClueStats.count} clues, avg ${game.redClueStats.avgNumber.toFixed(1)}
                        ${game.redClueStats.stdNumber > 0 ? ` (±${game.redClueStats.stdNumber.toFixed(1)})` : ''}
                      </span>
                    </div>
                    ${game.timingStats?.red && html`
                      <div class="detail-row">
                        <span class="detail-label">Time:</span>
                        <span class="detail-value">
                          SM: ${formatMs(game.timingStats.red.spymasterMs)},
                          G: ${formatMs(game.timingStats.red.guesserMs)}
                          (Total: ${formatMs(game.timingStats.red.spymasterMs + game.timingStats.red.guesserMs)})
                        </span>
                      </div>
                    `}
                  </div>

                  <div class="team-details blue">
                    <h4>🔵 Blue Team</h4>
                    <div class="detail-row">
                      ${getDetailedModelDisplay(game.blueConfig?.spymaster, 'Spymaster')}
                    </div>
                    <div class="detail-row">
                      ${getDetailedModelDisplay(game.blueConfig?.guesser, 'Guesser')}
                    </div>
                    ${game.bluePlayers.length > 0 && html`
                      <div class="detail-row">
                        <span class="detail-label">Players:</span>
                        <span class="detail-value">${game.bluePlayers.join(', ')}</span>
                      </div>
                    `}
                    <div class="detail-row">
                      <span class="detail-label">Clues:</span>
                      <span class="detail-value">
                        ${game.blueClueStats.count} clues, avg ${game.blueClueStats.avgNumber.toFixed(1)}
                        ${game.blueClueStats.stdNumber > 0 ? ` (±${game.blueClueStats.stdNumber.toFixed(1)})` : ''}
                      </span>
                    </div>
                    ${game.timingStats?.blue && html`
                      <div class="detail-row">
                        <span class="detail-label">Time:</span>
                        <span class="detail-value">
                          SM: ${formatMs(game.timingStats.blue.spymasterMs)},
                          G: ${formatMs(game.timingStats.blue.guesserMs)}
                          (Total: ${formatMs(game.timingStats.blue.spymasterMs + game.timingStats.blue.guesserMs)})
                        </span>
                      </div>
                    `}
                  </div>

                  <div class="end-reason">
                    ${getEndReasonDisplay(game.endReason, game.winner)}
                  </div>
                </div>
              `}

              <div class="expand-hint">${expanded === idx ? '▲ Less' : '▼ More'}</div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// Available AI models
const AI_MODELS = [
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', description: 'Most accurate (slow)', warning: 'May take 2-5+ min' },
  { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Latest flagship v2' },
  { id: 'gpt-5.1', name: 'GPT-5.1', description: 'Latest flagship' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Fast GPT-5' },
  { id: 'gpt-4.1', name: 'GPT-4.1', description: 'Fast & capable' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Best quality' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & efficient' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Ultra fast' },
  { id: 'o3', name: 'o3', description: 'Advanced reasoning', warning: 'May take 2-5+ min' },
  { id: 'o4-mini', name: 'o4-mini', description: 'Efficient reasoning' },
];

// Models that support reasoning_effort parameter
const REASONING_MODELS = ['gpt-5.1', 'gpt-5.2', 'gpt-5.2-pro', 'gpt-5-mini', 'o3', 'o4-mini', 'o3-mini', 'o1', 'o1-mini'];

// Models that require background mode (async polling)
const BACKGROUND_MODE_MODELS = ['gpt-5.2-pro', 'o3', 'o1-pro'];

// Check if a model requires background mode
function requiresBackgroundMode(modelId) {
  return BACKGROUND_MODE_MODELS.some(m => modelId.startsWith(m));
}

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

  // Multi-model config: each role can have multiple model entries
  const [multiModelConfig, setMultiModelConfig] = useState(gameState?.multiModelConfig || {
    redSpymaster: [{ model: DEFAULT_SPYMASTER_MODEL }],
    redGuesser: [{ model: DEFAULT_GUESSER_MODEL }],
    blueSpymaster: [{ model: DEFAULT_SPYMASTER_MODEL }],
    blueGuesser: [{ model: DEFAULT_GUESSER_MODEL }],
  });

  // Local state for textarea editing (to avoid API calls on every keystroke)
  const [localInstructions, setLocalInstructions] = useState({});

  const [expandedInstructions, setExpandedInstructions] = useState({});

  const [allowHumanAIHelp, setAllowHumanAIHelp] = useState(!!gameState?.allowHumanAIHelp);

  const [giveAIPastTurnInfo, setGiveAIPastTurnInfo] = useState(!!gameState?.giveAIPastTurnInfo);

  const [assassinBehavior, setAssassinBehavior] = useState(gameState?.assassinBehavior || 'instant_loss');

  const [turnTimer, setTurnTimer] = useState(gameState?.turnTimer || null);

  // Simulation settings for AI spymaster
  const [simulationCount, setSimulationCount] = useState(gameState?.simulationCount || 0);
  const [simulationModel, setSimulationModel] = useState(gameState?.simulationModel || 'gpt-4o');

  // Presets UI/state (saved in localStorage on this device)
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    const loaded = loadPresets();
    setPresets(loaded);
    if (loaded.length > 0) setSelectedPresetId(loaded[0].id);
  }, []);

  // Sync roleConfig from server updates (e.g., when players join)
  useEffect(() => {
    if (gameState?.roleConfig) {
      setRoleConfig(gameState.roleConfig);
    }
    if (gameState?.multiModelConfig) {
      setMultiModelConfig(gameState.multiModelConfig);
    }
    if (typeof gameState?.allowHumanAIHelp === 'boolean') {
      setAllowHumanAIHelp(gameState.allowHumanAIHelp);
    }
    if (typeof gameState?.giveAIPastTurnInfo === 'boolean') {
      setGiveAIPastTurnInfo(gameState.giveAIPastTurnInfo);
    }
    if (gameState?.assassinBehavior) {
      setAssassinBehavior(gameState.assassinBehavior);
    }
    // turnTimer can be null, so check with 'in' operator
    if ('turnTimer' in (gameState || {})) {
      setTurnTimer(gameState.turnTimer);
    }
    // Simulation settings
    if (typeof gameState?.simulationCount === 'number') {
      setSimulationCount(gameState.simulationCount);
    }
    if (gameState?.simulationModel) {
      setSimulationModel(gameState.simulationModel);
    }
  }, [gameState?.roleConfig, gameState?.multiModelConfig, gameState?.allowHumanAIHelp, gameState?.giveAIPastTurnInfo, gameState?.assassinBehavior, gameState?.turnTimer, gameState?.simulationCount, gameState?.simulationModel]);

  const updateRole = (role, value) => {
    const newRoleConfig = { ...roleConfig, [role]: value };
    setRoleConfig(newRoleConfig);
    onConfigure({ roleConfig: newRoleConfig, multiModelConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount, simulationModel });
  };

  // Multi-model config helpers
  const updateModelEntry = (role, entryIndex, field, value) => {
    const newEntries = [...multiModelConfig[role]];
    newEntries[entryIndex] = { ...newEntries[entryIndex], [field]: value };
    // Clear reasoning effort if the new model doesn't support it
    if (field === 'model' && !supportsReasoningEffort(value)) {
      delete newEntries[entryIndex].reasoningEffort;
    }
    const newConfig = { ...multiModelConfig, [role]: newEntries };
    setMultiModelConfig(newConfig);
    onConfigure({ roleConfig, multiModelConfig: newConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount, simulationModel });
  };

  const addModelEntry = (role) => {
    const defaultModel = role.includes('Spymaster') ? DEFAULT_SPYMASTER_MODEL : DEFAULT_GUESSER_MODEL;
    const newEntries = [...multiModelConfig[role], { model: defaultModel }];
    const newConfig = { ...multiModelConfig, [role]: newEntries };
    setMultiModelConfig(newConfig);
    onConfigure({ roleConfig, multiModelConfig: newConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount, simulationModel });
  };

  const removeModelEntry = (role, entryIndex) => {
    if (multiModelConfig[role].length <= 1) return; // Can't remove last entry
    const newEntries = multiModelConfig[role].filter((_, i) => i !== entryIndex);
    const newConfig = { ...multiModelConfig, [role]: newEntries };
    setMultiModelConfig(newConfig);
    onConfigure({ roleConfig, multiModelConfig: newConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount, simulationModel });
  };

  const updateCustomInstructions = (role, entryIndex, instructions) => {
    const newEntries = [...multiModelConfig[role]];
    if (instructions && instructions.trim()) {
      newEntries[entryIndex] = { ...newEntries[entryIndex], customInstructions: instructions };
    } else {
      const { customInstructions, ...rest } = newEntries[entryIndex];
      newEntries[entryIndex] = rest;
    }
    const newConfig = { ...multiModelConfig, [role]: newEntries };
    setMultiModelConfig(newConfig);
    onConfigure({ roleConfig, multiModelConfig: newConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount, simulationModel });
  };

  const toggleInstructionsExpanded = (role, entryIndex) => {
    const key = `${role}-${entryIndex}`;
    setExpandedInstructions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateAllowHumanAIHelp = (value) => {
    setAllowHumanAIHelp(value);
    onConfigure({ roleConfig, multiModelConfig, allowHumanAIHelp: value, giveAIPastTurnInfo, simulationCount, simulationModel });
  };

  const updateGiveAIPastTurnInfo = (value) => {
    setGiveAIPastTurnInfo(value);
    onConfigure({ roleConfig, multiModelConfig, allowHumanAIHelp, giveAIPastTurnInfo: value, simulationCount, simulationModel });
  };

  const updateSimulationCount = (count) => {
    setSimulationCount(count);
    onConfigure({ roleConfig, multiModelConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount: count, simulationModel });
  };

  const updateSimulationModel = (model) => {
    setSimulationModel(model);
    onConfigure({ roleConfig, multiModelConfig, allowHumanAIHelp, giveAIPastTurnInfo, simulationCount, simulationModel: model });
  };

  const updateAssassinBehavior = async (behavior) => {
    setAssassinBehavior(behavior);
    try {
      await api(`/api/games/${roomCode}/set-assassin-behavior`, {
        method: 'POST',
        body: JSON.stringify({ assassinBehavior: behavior }),
      });
    } catch (err) {
      console.error('Set assassin behavior error:', err);
    }
  };

  const updateTurnTimer = async (timer) => {
    setTurnTimer(timer);
    try {
      await api(`/api/games/${roomCode}/set-turn-timer`, {
        method: 'POST',
        body: JSON.stringify({ turnTimer: timer }),
      });
    } catch (err) {
      console.error('Set turn timer error:', err);
    }
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

  const currentPresetSettings = () => ({
    roleConfig,
    multiModelConfig,
    allowHumanAIHelp,
    giveAIPastTurnInfo,
    assassinBehavior,
    turnTimer,
    simulationCount,
    simulationModel,
  });

  const saveNewPreset = () => {
    const name = presetName.trim();
    if (!name) {
      alert('Please enter a preset name');
      return;
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const next = [
      { id, name, createdAt: Date.now(), updatedAt: Date.now(), settings: currentPresetSettings() },
      ...presets,
    ];
    setPresets(next);
    setSelectedPresetId(id);
    setPresetName('');
    persistPresets(next);
  };

  const updateSelectedPreset = () => {
    if (!selectedPresetId) return;
    const next = presets.map(p => p.id === selectedPresetId
      ? { ...p, updatedAt: Date.now(), settings: currentPresetSettings() }
      : p
    );
    setPresets(next);
    persistPresets(next);
  };

  const deleteSelectedPreset = () => {
    if (!selectedPresetId) return;
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) return;
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    const next = presets.filter(p => p.id !== selectedPresetId);
    setPresets(next);
    setSelectedPresetId(next[0]?.id || '');
    persistPresets(next);
  };

  const loadSelectedPreset = async () => {
    if (!selectedPresetId) return;
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset?.settings) return;
    const s = preset.settings;

    // Update local state immediately for UI
    if (s.roleConfig) setRoleConfig(s.roleConfig);
    if (s.multiModelConfig) setMultiModelConfig(s.multiModelConfig);
    if (typeof s.allowHumanAIHelp === 'boolean') setAllowHumanAIHelp(s.allowHumanAIHelp);
    if (typeof s.giveAIPastTurnInfo === 'boolean') setGiveAIPastTurnInfo(s.giveAIPastTurnInfo);
    if (typeof s.simulationCount === 'number') setSimulationCount(s.simulationCount);
    if (typeof s.simulationModel === 'string') setSimulationModel(s.simulationModel);
    if (typeof s.assassinBehavior === 'string') setAssassinBehavior(s.assassinBehavior);
    if ('turnTimer' in s) setTurnTimer(s.turnTimer);

    // Reset local textarea state so it matches loaded model entries
    setLocalInstructions({});
    setExpandedInstructions({});

    // Persist to server
    onConfigure({
      roleConfig: s.roleConfig || roleConfig,
      multiModelConfig: s.multiModelConfig || multiModelConfig,
      allowHumanAIHelp: typeof s.allowHumanAIHelp === 'boolean' ? s.allowHumanAIHelp : allowHumanAIHelp,
      giveAIPastTurnInfo: typeof s.giveAIPastTurnInfo === 'boolean' ? s.giveAIPastTurnInfo : giveAIPastTurnInfo,
      simulationCount: typeof s.simulationCount === 'number' ? s.simulationCount : simulationCount,
      simulationModel: typeof s.simulationModel === 'string' ? s.simulationModel : simulationModel,
    });
    if (typeof s.assassinBehavior === 'string') await updateAssassinBehavior(s.assassinBehavior);
    if ('turnTimer' in s) await updateTurnTimer(s.turnTimer);
  };

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

      <div style="margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
        <div style="font-weight: 600; margin-bottom: 0.75rem;">Presets</div>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
          <select
            value=${selectedPresetId}
            onChange=${(e) => setSelectedPresetId(e.target.value)}
            style="flex: 1; min-width: 220px; padding: 0.5rem;"
          >
            <option value="">Select a preset…</option>
            ${presets.map(p => html`<option value=${p.id}>${p.name}</option>`)}
          </select>
          <button class="btn btn-outline btn-small" onClick=${loadSelectedPreset} disabled=${!selectedPresetId}>
            Load
          </button>
          <button class="btn btn-outline btn-small" onClick=${updateSelectedPreset} disabled=${!selectedPresetId}>
            Save
          </button>
          <button class="btn btn-outline btn-small" onClick=${deleteSelectedPreset} disabled=${!selectedPresetId}>
            Delete
          </button>
        </div>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; margin-top: 0.75rem;">
          <input
            type="text"
            value=${presetName}
            onInput=${(e) => setPresetName(e.target.value)}
            placeholder="New preset name"
            style="flex: 1; min-width: 220px; padding: 0.5rem;"
          />
          <button class="btn btn-blue btn-small" onClick=${saveNewPreset}>
            Save As New
          </button>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-light);">
          Saved locally on this device (not shared with other players).
        </div>
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

      <div style="margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
        <label style="display: flex; gap: 0.75rem; align-items: flex-start; cursor: pointer;">
          <input
            type="checkbox"
            checked=${giveAIPastTurnInfo}
            onChange=${(e) => updateGiveAIPastTurnInfo(e.target.checked)}
            style="margin-top: 0.2rem;"
          />
          <div>
            <div style="font-weight: 600;">Give AI past turn information</div>
            <div style="font-size: 0.9rem; color: var(--text-light);">
              When enabled, AI players receive detailed history of past clues and guesses, helping them track "outstanding" words from previous clues and make more strategic decisions.
            </div>
          </div>
        </label>
      </div>

      <div style="margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
        <div style="font-weight: 600; margin-bottom: 0.75rem;">Assassin Behavior</div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer;">
            <input
              type="radio"
              name="assassin-behavior"
              checked=${assassinBehavior === 'instant_loss'}
              onChange=${() => updateAssassinBehavior('instant_loss')}
              style="margin-top: 0.2rem;"
            />
            <div>
              <div>Instant Loss (Default)</div>
              <div style="font-size: 0.85rem; color: var(--text-light);">Team that guesses the assassin loses immediately.</div>
            </div>
          </label>
          <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer;">
            <input
              type="radio"
              name="assassin-behavior"
              checked=${assassinBehavior === 'reveal_opponent'}
              onChange=${() => updateAssassinBehavior('reveal_opponent')}
              style="margin-top: 0.2rem;"
            />
            <div>
              <div>Reveal Opponent Cards</div>
              <div style="font-size: 0.85rem; color: var(--text-light);">Reveals 2 random cards for the opposing team (they get free progress).</div>
            </div>
          </label>
          <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer;">
            <input
              type="radio"
              name="assassin-behavior"
              checked=${assassinBehavior === 'add_own_cards'}
              onChange=${() => updateAssassinBehavior('add_own_cards')}
              style="margin-top: 0.2rem;"
            />
            <div>
              <div>Add Own Cards</div>
              <div style="font-size: 0.85rem; color: var(--text-light);">Converts 2 neutral cards into your team's cards (more work for you).</div>
            </div>
          </label>
        </div>
      </div>

      <div style="margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
        <div style="font-weight: 600; margin-bottom: 0.75rem;">Turn Timer</div>
        <div style="font-size: 0.85rem; color: var(--text-light); margin-bottom: 0.75rem;">
          If enabled, each team's turn will automatically end when the timer expires.
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.75rem;">
          ${[
            { value: null, label: 'None' },
            { value: 60, label: '1 min' },
            { value: 120, label: '2 min' },
            { value: 180, label: '3 min' },
            { value: 240, label: '4 min' },
          ].map(option => html`
            <label style="display: flex; gap: 0.35rem; align-items: center; cursor: pointer;">
              <input
                type="radio"
                name="turn-timer"
                checked=${turnTimer === option.value}
                onChange=${() => updateTurnTimer(option.value)}
              />
              <span>${option.label}</span>
            </label>
          `)}
        </div>
      </div>

      ${(roleConfig.redSpymaster === 'ai' || roleConfig.blueSpymaster === 'ai') && html`
        <div style="margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-radius: 8px;">
          <div style="font-weight: 600; margin-bottom: 0.75rem;">AI Spymaster Simulation</div>
          <div style="font-size: 0.85rem; color: var(--text-light); margin-bottom: 0.75rem;">
            When enabled, the AI spymaster generates multiple candidate clues, simulates how the guesser would respond to each, and picks the best one.
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start;">
            <div>
              <label style="font-size: 0.85rem; color: var(--text-light); display: block; margin-bottom: 0.35rem;">Candidates to evaluate:</label>
              <select
                value=${simulationCount}
                onChange=${(e) => updateSimulationCount(parseInt(e.target.value))}
                style="font-size: 0.85rem; padding: 0.4rem;"
              >
                <option value="0">Off</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
                <option value="9">9</option>
              </select>
            </div>
            ${simulationCount > 0 && html`
              <div>
                <label style="font-size: 0.85rem; color: var(--text-light); display: block; margin-bottom: 0.35rem;">Simulation Guesser Model:</label>
                <select
                  value=${simulationModel}
                  onChange=${(e) => updateSimulationModel(e.target.value)}
                  style="font-size: 0.85rem; padding: 0.4rem;"
                >
                  ${AI_MODELS.map(m => html`
                    <option value=${m.id}>${m.name}</option>
                  `)}
                </select>
              </div>
            `}
          </div>
          ${simulationCount > 0 && html`
            <div style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-light);">
              This will make ${simulationCount} parallel API calls to generate candidates, then ${simulationCount} more to simulate guesses.
            </div>
          `}
        </div>
      `}

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
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                  <label style="font-size: 0.8rem; color: var(--text-light);">Models:</label>
                  ${multiModelConfig[role.key]?.length > 1 && html`
                    <span style="font-size: 0.75rem; color: var(--text-light);">(randomly selected each turn)</span>
                  `}
                </div>
                ${(multiModelConfig[role.key] || [{ model: role.type === 'spymaster' ? DEFAULT_SPYMASTER_MODEL : DEFAULT_GUESSER_MODEL }]).map((entry, entryIndex) => {
                  const instructionKey = `${role.key}-${entryIndex}`;
                  const hasCustomInstructions = entry.customInstructions && entry.customInstructions.trim();
                  return html`
                    <div style="margin-bottom: 0.75rem; padding: 0.5rem; background: rgba(0,0,0,0.03); border-radius: 6px; border: 1px solid var(--border);">
                      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                        <select
                          value=${entry.model}
                          onChange=${(e) => updateModelEntry(role.key, entryIndex, 'model', e.target.value)}
                          style="font-size: 0.85rem; padding: 0.4rem; flex: 1; min-width: 120px;"
                        >
                          ${AI_MODELS.map(m => html`
                            <option value=${m.id}>${m.name}</option>
                          `)}
                        </select>
                        ${supportsReasoningEffort(entry.model) && html`
                          <select
                            value=${entry.reasoningEffort || ''}
                            onChange=${(e) => updateModelEntry(role.key, entryIndex, 'reasoningEffort', e.target.value || undefined)}
                            style="font-size: 0.85rem; padding: 0.4rem; min-width: 100px;"
                            title="Reasoning Effort"
                          >
                            <option value="">Effort: Default</option>
                            <option value="none">None</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="xhigh">X-High</option>
                          </select>
                        `}
                        <button
                          type="button"
                          onClick=${() => removeModelEntry(role.key, entryIndex)}
                          disabled=${multiModelConfig[role.key].length <= 1}
                          style="background: none; border: none; cursor: ${multiModelConfig[role.key].length <= 1 ? 'not-allowed' : 'pointer'}; font-size: 1.1rem; color: ${multiModelConfig[role.key].length <= 1 ? '#ccc' : 'var(--red)'}; padding: 0.2rem 0.4rem;"
                          title="Remove this model"
                        >
                          −
                        </button>
                      </div>
                      <div style="margin-top: 0.5rem;">
                        <button
                          type="button"
                          onClick=${() => toggleInstructionsExpanded(role.key, entryIndex)}
                          style="background: none; border: none; cursor: pointer; font-size: 0.8rem; color: var(--text-light); padding: 0; display: flex; align-items: center; gap: 0.25rem;"
                        >
                          <span style="transition: transform 0.2s; transform: rotate(${expandedInstructions[instructionKey] ? '90deg' : '0deg'}); font-size: 0.7rem;">▶</span>
                          Instructions
                          ${hasCustomInstructions ? html`<span style="color: var(--${role.team}); font-weight: 600;"> *</span>` : ''}
                        </button>
                        ${expandedInstructions[instructionKey] && html`
                          <div style="margin-top: 0.35rem;">
                            <textarea
                              value=${localInstructions[instructionKey] !== undefined ? localInstructions[instructionKey] : (entry.customInstructions || '')}
                              onInput=${(e) => setLocalInstructions(prev => ({ ...prev, [instructionKey]: e.target.value }))}
                              onBlur=${(e) => {
                                updateCustomInstructions(role.key, entryIndex, e.target.value);
                                setLocalInstructions(prev => {
                                  const next = { ...prev };
                                  delete next[instructionKey];
                                  return next;
                                });
                              }}
                              placeholder="e.g., 'Be conservative', 'Take more risks'..."
                              style="width: 100%; min-height: 50px; font-size: 0.8rem; padding: 0.4rem; border: 1px solid var(--border); border-radius: 4px; resize: vertical;"
                            />
                          </div>
                        `}
                      </div>
                    </div>
                  `;
                })}
                <button
                  type="button"
                  onClick=${() => addModelEntry(role.key)}
                  style="background: none; border: 1px dashed var(--border); cursor: pointer; font-size: 0.85rem; color: var(--text-light); padding: 0.4rem 0.75rem; border-radius: 4px; display: flex; align-items: center; gap: 0.25rem; width: 100%; justify-content: center;"
                >
                  <span style="font-size: 1.1rem;">+</span> Add Model
                </button>
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
  const lastCreatedAtRef = useRef(null);

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
    return startAdaptivePolling(fetchState, 4000, 15000);
  }, [fetchState]);

  // AI state - declared early so useEffect can reference it
  const [aiClue, setAiClue] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiClueRequested, setAiClueRequested] = useState(false);
  const [aiGuessRequested, setAiGuessRequested] = useState(false);

  // When a new game starts in the same room (Play Again), reset local AI request state.
  useEffect(() => {
    if (!gameState?.createdAt) return;
    if (lastCreatedAtRef.current === null) {
      lastCreatedAtRef.current = gameState.createdAt;
      return;
    }
    if (lastCreatedAtRef.current !== gameState.createdAt) {
      lastCreatedAtRef.current = gameState.createdAt;
      setAiClue(null);
      setAiSuggestions(null);
      setAiLoading(false);
      setAiClueRequested(false);
      setAiGuessRequested(false);
      setShowWinnerModal(true);
    }
  }, [gameState?.createdAt]);

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

            ${/* Team member display */ ''}
            <div class="winner-teams">
              ${['red', 'blue'].map(team => {
                const isWinner = team === winner;
                const spymasterKey = `${team}Spymaster`;
                const guesserKey = `${team}Guesser`;
                const isAISpymaster = gameState.roleConfig[spymasterKey] === 'ai';
                const isAIGuesser = gameState.roleConfig[guesserKey] === 'ai';
                const humanSpymaster = gameState.players?.find(p => p.team === team && p.role === 'spymaster');
                const humanGuesser = gameState.players?.find(p => p.team === team && p.role === 'guesser');

                return html`
                  <div class="winner-team ${team} ${isWinner ? 'winning' : 'losing'}">
                    <div class="winner-team-header">${isWinner ? '🏆' : ''} ${team.toUpperCase()} ${isWinner ? '🏆' : ''}</div>
                    <div class="winner-team-members">
                      <div class="member-row">
                        <span class="member-role">Spymaster:</span>
                        <span class="member-name">
                          ${isAISpymaster
                            ? html`<span class="ai-badge">🤖 ${gameState.modelConfig[spymasterKey]}</span>`
                            : humanSpymaster?.name || 'Unknown'
                          }
                        </span>
                      </div>
                      <div class="member-row">
                        <span class="member-role">Guesser:</span>
                        <span class="member-name">
                          ${isAIGuesser
                            ? html`<span class="ai-badge">🤖 ${gameState.modelConfig[guesserKey]}</span>`
                            : humanGuesser?.name || 'Unknown'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                `;
              })}
            </div>

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

      ${aiLoading && (() => {
        // Determine which model is thinking based on game state
        const isGuessingPhase = currentClue !== null;
        const roleKey = isGuessingPhase
          ? `${currentTeam}Guesser`
          : `${currentTeam}Spymaster`;
        const modelName = gameState.modelConfig?.[roleKey] || 'AI';
        const isSimulating = !isGuessingPhase && gameState.simulationCount > 0;
        return html`
          <div style="text-align: center; margin: 1rem 0; padding: 0.75rem; background: #e3f2fd; border-radius: 8px; animation: pulse 1.5s ease-in-out infinite;">
            <span>${isSimulating
              ? `Evaluating ${gameState.simulationCount} clue candidates...`
              : `${modelName} is thinking...`
            }</span>
          </div>
        `;
      })()}

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
          // Only show if showAIReasoning is enabled (defaults to true)
          const aiReasoning = gameState.showAIReasoning !== false ? clue.guesses?.find(g => g.aiReasoning)?.aiReasoning : null;
          // Show spymaster reasoning if enabled (off by default)
          const spymasterReasoning = gameState.showSpymasterReasoning === true ? clue.spymasterReasoning : null;
          const riskAssessment = gameState.showSpymasterReasoning === true ? clue.riskAssessment : null;
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
              ${spymasterReasoning ? html`
                <div class="ai-reasoning spymaster-reasoning" style="margin-top: 0.5rem; padding: 0.5rem; background: #e8f4fd; border-radius: 4px; font-size: 0.8rem; color: #1565c0; border-left: 3px solid #1976d2;">
                  <strong>Spymaster reasoning:</strong> ${spymasterReasoning}
                  ${riskAssessment ? html`<div style="margin-top: 0.25rem;"><strong>Risk assessment:</strong> ${riskAssessment}</div>` : null}
                </div>
              ` : null}
              ${aiReasoning ? html`
                <div class="ai-reasoning" style="margin-top: 0.5rem; padding: 0.5rem; background: #f5f5f5; border-radius: 4px; font-size: 0.8rem; color: #666;">
                  <strong>Guesser reasoning:</strong> ${aiReasoning}
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
function HostView({ roomCode, onLeave, onReplay }) {
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiActionPending, setAiActionPending] = useState(false);
  const [showWinnerModal, setShowWinnerModal] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [playAgainLoading, setPlayAgainLoading] = useState(false);
  const lastCreatedAtRef = useRef(null);

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
    return startAdaptivePolling(fetchState, 4000, 15000);
  }, [fetchState]);

  // When a new game starts in the same room (Play Again), clear any lingering local AI locks.
  useEffect(() => {
    if (!gameState?.createdAt) return;
    if (lastCreatedAtRef.current === null) {
      lastCreatedAtRef.current = gameState.createdAt;
      return;
    }
    if (lastCreatedAtRef.current !== gameState.createdAt) {
      lastCreatedAtRef.current = gameState.createdAt;
      setAiLoading(false);
      setAiActionPending(false);
      setShowWinnerModal(true);
    }
  }, [gameState?.createdAt]);

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

  const toggleAIReasoning = async (showAIReasoning) => {
    try {
      await api(`/api/games/${roomCode}/toggle-ai-reasoning`, {
        method: 'POST',
        body: JSON.stringify({ showAIReasoning }),
      });
      fetchState();
    } catch (err) {
      console.error('Toggle AI reasoning error:', err);
    }
  };

  const toggleSpymasterReasoning = async (showSpymasterReasoning) => {
    try {
      await api(`/api/games/${roomCode}/toggle-spymaster-reasoning`, {
        method: 'POST',
        body: JSON.stringify({ showSpymasterReasoning }),
      });
      fetchState();
    } catch (err) {
      console.error('Toggle spymaster reasoning error:', err);
    }
  };

  const pauseGame = async () => {
    try {
      await api(`/api/games/${roomCode}/pause`, {
        method: 'POST',
      });
      fetchState();
    } catch (err) {
      console.error('Pause game error:', err);
    }
  };

  const resumeGame = async () => {
    try {
      await api(`/api/games/${roomCode}/resume`, {
        method: 'POST',
      });
      fetchState();
    } catch (err) {
      console.error('Resume game error:', err);
    }
  };

  const toggleSimulationDetails = async (showSimulationDetails) => {
    try {
      await api(`/api/games/${roomCode}/toggle-simulation-details`, {
        method: 'POST',
        body: JSON.stringify({ showSimulationDetails }),
      });
      fetchState();
    } catch (err) {
      console.error('Toggle simulation details error:', err);
    }
  };

  // Auto-trigger AI actions for host view
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing' || gameState.winner) return;
    if (gameState.isPaused) return; // Don't auto-trigger AI actions when paused
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
      const modelKey = `${currentTeam}Spymaster`;
      const model = gameState.modelConfig?.[modelKey] || 'gpt-4o';
      const isBackgroundModel = requiresBackgroundMode(model);
      console.log('Host: Auto-triggering AI clue for', currentTeam, 'using', model, 'background:', isBackgroundModel);

      (async () => {
        try {
          // Start the clue generation
          const startResult = await api(`/api/games/${roomCode}/ai-clue`, {
            method: 'POST',
            body: JSON.stringify({}),
          });

          // If using background mode, poll for completion
          if (startResult.status === 'started' || startResult.status === 'pending') {
            console.log('Background clue started, polling...');
            let pollAttempts = 0;
            const maxAttempts = 300; // 5 minutes at 1 second intervals
            while (pollAttempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              const statusResult = await api(`/api/games/${roomCode}/ai-clue-status`);

              if (statusResult.status === 'completed') {
                console.log('Background clue completed:', statusResult.clue);
                // Confirm the clue
                await api(`/api/games/${roomCode}/ai-clue`, {
                  method: 'POST',
                  body: JSON.stringify({ confirm: true }),
                });
                break;
              } else if (statusResult.status === 'failed' || statusResult.status === 'cancelled') {
                console.error('Background clue failed:', statusResult.error || statusResult.message);
                break;
              }
              pollAttempts++;
            }
          } else {
            // Synchronous model - confirm immediately
            await new Promise(resolve => setTimeout(resolve, 500));
            await api(`/api/games/${roomCode}/ai-clue`, {
              method: 'POST',
              body: JSON.stringify({ confirm: true }),
            });
          }
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

  // Handle turn timer expiration - auto-end turn
  const handleTurnTimeUp = useCallback(async () => {
    if (!gameState || gameState.phase !== 'playing' || gameState.winner) return;
    if (gameState.isPaused) return; // Don't auto-end turn when paused

    console.log('Turn timer expired, auto-ending turn');
    try {
      await api(`/api/games/${roomCode}/end-turn`, {
        method: 'POST',
      });
      fetchState();
    } catch (err) {
      console.error('Auto end-turn error:', err);
    }
  }, [gameState, roomCode, fetchState]);

  const handlePlayAgain = useCallback(async () => {
    setPlayAgainLoading(true);
    try {
      const data = await api(`/api/games/${roomCode}/replay`, {
        method: 'POST',
      });
      if (data.gameState) setGameState(data.gameState);
    } catch (err) {
      console.error('Play again error:', err);
      alert('Failed to create new game: ' + err.message);
    } finally {
      setPlayAgainLoading(false);
    }
  }, [roomCode, onReplay]);

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
          ${gameState.phase === 'playing' && !gameState.winner && html`
            <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
              ${gameState.isPaused ? html`
                <div style="display: flex; align-items: center; gap: 1rem;">
                  <button class="btn btn-blue" onClick=${resumeGame} style="font-size: 1.1rem; padding: 0.75rem 1.5rem;">
                    Resume Game
                  </button>
                  <span style="color: var(--text-light); font-style: italic;">Game is paused - all timers stopped</span>
                </div>
              ` : html`
                <button class="btn btn-outline" onClick=${pauseGame} style="font-size: 1rem;">
                  Pause Game
                </button>
              `}
            </div>
          `}

          <h3 style="margin: 0 0 0.75rem 0;">Settings</h3>
          <label style="display: flex; gap: 0.75rem; align-items: center; cursor: pointer; padding: 0.5rem 0;">
            <input
              type="checkbox"
              checked=${gameState.showAIReasoning !== false}
              onChange=${(e) => toggleAIReasoning(e.target.checked)}
            />
            <span>Show AI guesser reasoning in clue history</span>
          </label>
          <label style="display: flex; gap: 0.75rem; align-items: center; cursor: pointer; padding: 0.5rem 0;">
            <input
              type="checkbox"
              checked=${gameState.showSpymasterReasoning === true}
              onChange=${(e) => toggleSpymasterReasoning(e.target.checked)}
            />
            <span>Show AI spymaster reasoning (debug mode)</span>
          </label>
          ${gameState.simulationCount > 0 && html`
            <label style="display: flex; gap: 0.75rem; align-items: center; cursor: pointer; padding: 0.5rem 0;">
              <input
                type="checkbox"
                checked=${gameState.showSimulationDetails === true}
                onChange=${(e) => toggleSimulationDetails(e.target.checked)}
              />
              <span>Show simulation evaluation details</span>
            </label>
          `}

          ${gameState.showSimulationDetails && gameState.lastSimulationResults && gameState.lastSimulationResults.length > 0 && html`
            <div style="margin-top: 1rem; padding: 1rem; background: #f8f8f8; border-radius: 8px;">
              <h4 style="margin: 0 0 0.75rem 0;">Last Simulation Results</h4>
              <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                ${gameState.lastSimulationResults.map((result, idx) => html`
                  <div style="padding: 0.75rem; background: white; border-radius: 6px; border: 2px solid ${idx === 0 ? '#4caf50' : '#ddd'};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                      <div>
                        <strong style="font-size: 1.1rem;">"${result.candidate.clue}" for ${result.candidate.number}</strong>
                        ${idx === 0 && html`<span style="margin-left: 0.5rem; color: #4caf50; font-weight: bold;">WINNER</span>`}
                      </div>
                      <div style="font-size: 1.2rem; font-weight: bold; color: ${result.totalScore >= 0 ? '#4caf50' : '#f44336'};">
                        ${result.totalScore >= 0 ? '+' : ''}${result.totalScore.toFixed(2)}
                      </div>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-light); margin-bottom: 0.35rem; display: flex; gap: 1rem; flex-wrap: wrap;">
                      ${result.candidate.generatedByModel && html`
                        <span><strong>Generated by:</strong> ${result.candidate.generatedByModel}</span>
                      `}
                      ${result.simulationGuesserModel && html`
                        <span><strong>Simulated guesser:</strong> ${result.simulationGuesserModel}</span>
                      `}
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-light); margin-bottom: 0.5rem;">
                      Targets: ${result.candidate.intendedTargets.join(', ')}
                    </div>
                    <div style="font-size: 0.85rem; margin-bottom: 0.5rem;">
                      <strong>Simulated guesses:</strong>
                      ${result.guessResults.map(g => html`
                        <span style="margin-left: 0.5rem; padding: 0.15rem 0.4rem; border-radius: 4px; background: ${
                          g.cardType === gameState.currentTeam ? '#e8f5e9' :
                          g.cardType === 'neutral' ? '#f5f5f5' :
                          g.cardType === 'assassin' ? '#ffebee' : '#e3f2fd'
                        };">
                          ${g.word} (${g.points >= 0 ? '+' : ''}${g.points.toFixed(2)})
                        </span>
                      `)}
                    </div>
                    ${result.outstandingCount > 0 && html`
                      <div style="font-size: 0.85rem; color: #2196f3;">
                        +${(result.outstandingCount * 0.4).toFixed(2)} outstanding credit (${result.outstandingCount} unhinted)
                      </div>
                    `}
                    ${result.opponentEndPenalty < 0 && html`
                      <div style="font-size: 0.85rem; color: #f44336;">
                        ${result.opponentEndPenalty.toFixed(2)} opponent position penalty
                      </div>
                    `}
                  </div>
                `)}
              </div>
            </div>
          `}

          <h3 style="margin: 1rem 0 0.75rem 0;">Reset Seats</h3>
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

            ${/* Team member display */ ''}
            <div class="winner-teams">
              ${['red', 'blue'].map(team => {
                const isWinner = team === winner;
                const spymasterKey = `${team}Spymaster`;
                const guesserKey = `${team}Guesser`;
                const isAISpymaster = gameState.roleConfig[spymasterKey] === 'ai';
                const isAIGuesser = gameState.roleConfig[guesserKey] === 'ai';
                const humanSpymaster = gameState.players?.find(p => p.team === team && p.role === 'spymaster');
                const humanGuesser = gameState.players?.find(p => p.team === team && p.role === 'guesser');

                return html`
                  <div class="winner-team ${team} ${isWinner ? 'winning' : 'losing'}">
                    <div class="winner-team-header">${isWinner ? '🏆' : ''} ${team.toUpperCase()} ${isWinner ? '🏆' : ''}</div>
                    <div class="winner-team-members">
                      <div class="member-row">
                        <span class="member-role">Spymaster:</span>
                        <span class="member-name">
                          ${isAISpymaster
                            ? html`<span class="ai-badge">🤖 ${gameState.modelConfig[spymasterKey]}</span>`
                            : humanSpymaster?.name || 'Unknown'
                          }
                        </span>
                      </div>
                      <div class="member-row">
                        <span class="member-role">Guesser:</span>
                        <span class="member-name">
                          ${isAIGuesser
                            ? html`<span class="ai-badge">🤖 ${gameState.modelConfig[guesserKey]}</span>`
                            : humanGuesser?.name || 'Unknown'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                `;
              })}
            </div>

            <div class="winner-actions">
              <button class="btn btn-outline" onClick=${() => setShowWinnerModal(false)}>View Board</button>
              <button class="btn btn-green" onClick=${handlePlayAgain} disabled=${playAgainLoading}>
                ${playAgainLoading ? 'Starting...' : 'Play Again'}
              </button>
              <button class="btn btn-blue" onClick=${onLeave}>New Game</button>
            </div>
          </div>
        </div>
      `}

      ${winner && !showWinnerModal && html`
        <div class="winner-banner ${winner}">
          <span>${winner.toUpperCase()} WINS!</span>
          <button class="btn btn-green btn-small" onClick=${handlePlayAgain} disabled=${playAgainLoading}>
            ${playAgainLoading ? 'Starting...' : 'Play Again'}
          </button>
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

      <${TimingDisplay} gameState=${gameState} />

      ${gameState.turnTimer && gameState.phase === 'playing' && !winner && html`
        <${TurnTimerCountdown}
          turnStartTime=${gameState.turnStartTime}
          turnTimer=${gameState.turnTimer}
          onTimeUp=${handleTurnTimeUp}
          isActive=${gameState.phase === 'playing' && !winner}
          isPaused=${gameState.isPaused}
        />
      `}

      ${aiLoading && (() => {
        // Determine which model is thinking based on game state
        const isGuessingPhase = currentClue !== null;
        const roleKey = isGuessingPhase
          ? `${currentTeam}Guesser`
          : `${currentTeam}Spymaster`;
        const modelName = gameState.modelConfig?.[roleKey] || 'AI';
        const isSimulating = !isGuessingPhase && gameState.simulationCount > 0;
        return html`
          <div style="text-align: center; margin: 1rem 0; padding: 1rem; background: #e3f2fd; border-radius: 8px; font-size: 1.5rem; animation: pulse 1.5s ease-in-out infinite;">
            ${isSimulating
              ? html`Evaluating ${gameState.simulationCount} clue candidates...`
              : html`${modelName} is thinking...`
            }
          </div>
        `;
      })()}

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

      <div class="history" style="max-width: 900px; margin: 2rem auto;">
        <h3>Clue History</h3>
        ${gameState.clueHistory.map(clue => {
          const aiReasoning = gameState.showAIReasoning !== false ? clue.guesses?.find(g => g.aiReasoning)?.aiReasoning : null;
          // Show spymaster reasoning if enabled (off by default)
          const spymasterReasoning = gameState.showSpymasterReasoning === true ? clue.spymasterReasoning : null;
          const riskAssessment = gameState.showSpymasterReasoning === true ? clue.riskAssessment : null;
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
              ${spymasterReasoning ? html`
                <div class="ai-reasoning spymaster-reasoning" style="margin-top: 0.5rem; padding: 0.5rem; background: #e8f4fd; border-radius: 4px; font-size: 0.8rem; color: #1565c0; border-left: 3px solid #1976d2;">
                  <strong>Spymaster reasoning:</strong> ${spymasterReasoning}
                  ${riskAssessment ? html`<div style="margin-top: 0.25rem;"><strong>Risk assessment:</strong> ${riskAssessment}</div>` : null}
                </div>
              ` : null}
              ${aiReasoning ? html`
                <div class="ai-reasoning" style="margin-top: 0.5rem; padding: 0.5rem; background: #f5f5f5; border-radius: 4px; font-size: 0.8rem; color: #666;">
                  <strong>Guesser reasoning:</strong> ${aiReasoning}
                </div>
              ` : null}
            </div>
          `;
        })}
      </div>
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
        onReplay=${(newRoomCode, players) => {
          // Navigate to the new game room
          setRoomCode(newRoomCode);
          // Store player info in session storage so players can auto-rejoin
          if (players && players.length > 0) {
            sessionStorage.setItem('replayPlayers', JSON.stringify(players));
          }
        }}
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
