/**
 * Codenames AI Worker - API routes
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Re-export the Durable Object
export { GameRoom } from './game';

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  GAME_REGISTRY: KVNamespace;
  GAME_HISTORY: D1Database;
  OPENAI_API_KEY?: string;
}

// Game registry entry stored in KV
interface GameRegistryEntry {
  roomCode: string;
  phase: 'setup' | 'playing' | 'finished';
  playerCount: number;
  humanRolesNeeded: number;
  redRemaining: number;
  blueRemaining: number;
  currentTeam: 'red' | 'blue';
  createdAt: number;
  updatedAt: number;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'Codenames AI API',
    version: '0.1.0',
    status: 'ok',
  });
});

// Generate a random 4-letter room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Removed I and O to avoid confusion
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Helper to update game registry
async function updateGameRegistry(kv: KVNamespace, roomCode: string, gameState: any) {
  if (!gameState) return;

  // Calculate human roles needed
  const roleConfig = gameState.roleConfig || {};
  const players = gameState.players || [];
  let humanRolesNeeded = 0;

  const roles = ['redSpymaster', 'redGuesser', 'blueSpymaster', 'blueGuesser'];
  for (const role of roles) {
    if (roleConfig[role] === 'human') {
      const [team, roleType] = role === 'redSpymaster' ? ['red', 'spymaster'] :
        role === 'redGuesser' ? ['red', 'guesser'] :
        role === 'blueSpymaster' ? ['blue', 'spymaster'] : ['blue', 'guesser'];
      const filled = players.some((p: any) => p.team === team && p.role === roleType);
      if (!filled) humanRolesNeeded++;
    }
  }

  const entry: GameRegistryEntry = {
    roomCode,
    phase: gameState.phase,
    playerCount: players.length,
    humanRolesNeeded,
    redRemaining: gameState.redRemaining,
    blueRemaining: gameState.blueRemaining,
    currentTeam: gameState.currentTeam,
    createdAt: gameState.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  await kv.put(`game:${roomCode}`, JSON.stringify(entry), {
    expirationTtl: 2 * 60 * 60, // 2 hour TTL
  });
}

// List active games
app.get('/api/games', async (c) => {
  try {
    // List all keys in the registry
    const list = await c.env.GAME_REGISTRY.list();
    const games: GameRegistryEntry[] = [];

    // Fetch each game's metadata
    for (const key of list.keys) {
      const data = await c.env.GAME_REGISTRY.get(key.name, 'json') as GameRegistryEntry | null;
      if (data) {
        // Only include games that aren't finished and were updated recently (last 2 hours)
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        if (data.phase !== 'finished' && data.updatedAt > twoHoursAgo) {
          games.push(data);
        } else {
          // Clean up old/finished games
          await c.env.GAME_REGISTRY.delete(key.name);
        }
      }
    }

    // Sort by most recently updated
    games.sort((a, b) => b.updatedAt - a.updatedAt);

    return c.json({ games });
  } catch (err) {
    return c.json({ games: [], error: String(err) });
  }
});

// Create a new game
app.post('/api/games', async (c) => {
  const roomCode = generateRoomCode();

  // Get or create Durable Object for this room
  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  // Forward request to Durable Object
  const response = await stub.fetch(new Request('http://internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode }),
  }));

  const data = await response.json() as any;

  // Register the game in KV
  if (response.ok && data.gameState) {
    await updateGameRegistry(c.env.GAME_REGISTRY, roomCode, data.gameState);
  }

  return c.json(data, response.status as any);
});

// Get game state
app.get('/api/games/:code', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const role = c.req.query('role');
  const team = c.req.query('team');

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const url = new URL('http://internal/state');
  if (role) url.searchParams.set('role', role);
  if (team) url.searchParams.set('team', team);

  const response = await stub.fetch(new Request(url.toString(), {
    method: 'GET',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Configure roles
app.post('/api/games/:code/configure', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json() as any;

  // Update registry
  if (response.ok && data.gameState) {
    await updateGameRegistry(c.env.GAME_REGISTRY, roomCode, data.gameState);
  }

  return c.json(data, response.status as any);
});

// Join game
app.post('/api/games/:code/join', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json() as any;

  // Update registry
  if (response.ok && data.gameState) {
    await updateGameRegistry(c.env.GAME_REGISTRY, roomCode, data.gameState);
  }

  return c.json(data, response.status as any);
});

// Start game
app.post('/api/games/:code/start', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/start', {
    method: 'POST',
  }));

  const data = await response.json() as any;

  // Update registry
  if (response.ok && data.gameState) {
    await updateGameRegistry(c.env.GAME_REGISTRY, roomCode, data.gameState);
  }

  return c.json(data, response.status as any);
});

// Submit clue
app.post('/api/games/:code/clue', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/clue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Submit guess
app.post('/api/games/:code/guess', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// End turn
app.post('/api/games/:code/end-turn', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/end-turn', {
    method: 'POST',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Kick/reset a seat (host convenience; no auth)
app.post('/api/games/:code/kick', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/kick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// AI clue
app.post('/api/games/:code/ai-clue', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json().catch(() => ({}));

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/ai-clue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// AI suggest
app.post('/api/games/:code/ai-suggest', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/ai-suggest', {
    method: 'POST',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// AI play
app.post('/api/games/:code/ai-play', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/ai-play', {
    method: 'POST',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// AI clue status (for background mode polling)
app.get('/api/games/:code/ai-clue-status', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/ai-clue-status', {
    method: 'GET',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// AI guess status (for background mode polling)
app.get('/api/games/:code/ai-guess-status', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/ai-guess-status', {
    method: 'GET',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Toggle AI reasoning visibility
app.post('/api/games/:code/toggle-ai-reasoning', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/toggle-ai-reasoning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Toggle spymaster reasoning visibility
app.post('/api/games/:code/toggle-spymaster-reasoning', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/toggle-spymaster-reasoning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Set assassin behavior
app.post('/api/games/:code/set-assassin-behavior', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/set-assassin-behavior', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Set turn timer
app.post('/api/games/:code/set-turn-timer', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();
  const body = await c.req.json();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/set-turn-timer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Pause game
app.post('/api/games/:code/pause', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/pause', {
    method: 'POST',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Resume game
app.post('/api/games/:code/resume', async (c) => {
  const roomCode = c.req.param('code').toUpperCase();

  const id = c.env.GAME_ROOM.idFromName(roomCode);
  const stub = c.env.GAME_ROOM.get(id);

  const response = await stub.fetch(new Request('http://internal/resume', {
    method: 'POST',
  }));

  const data = await response.json();
  return c.json(data, response.status as any);
});

// Get game history
app.get('/api/history', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const offset = parseInt(c.req.query('offset') || '0');

    const results = await c.env.GAME_HISTORY.prepare(`
      SELECT
        id, room_code, winner, red_final_score, blue_final_score,
        assassin_behavior, red_config, blue_config, red_players, blue_players,
        total_turns, red_turns, blue_turns, red_clue_stats, blue_clue_stats,
        end_reason, started_at, finished_at, duration_seconds, created_at, timing_stats
      FROM game_history
      ORDER BY finished_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    // Parse JSON fields
    const games = results.results.map((row: any) => ({
      id: row.id,
      roomCode: row.room_code,
      winner: row.winner,
      redFinalScore: row.red_final_score,
      blueFinalScore: row.blue_final_score,
      assassinBehavior: row.assassin_behavior,
      redConfig: JSON.parse(row.red_config),
      blueConfig: JSON.parse(row.blue_config),
      redPlayers: JSON.parse(row.red_players),
      bluePlayers: JSON.parse(row.blue_players),
      totalTurns: row.total_turns,
      redTurns: row.red_turns,
      blueTurns: row.blue_turns,
      redClueStats: JSON.parse(row.red_clue_stats),
      blueClueStats: JSON.parse(row.blue_clue_stats),
      endReason: row.end_reason,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at,
      timingStats: row.timing_stats ? JSON.parse(row.timing_stats) : null,
    }));

    // Get total count for pagination
    const countResult = await c.env.GAME_HISTORY.prepare(
      'SELECT COUNT(*) as count FROM game_history'
    ).first();

    return c.json({
      games,
      total: countResult?.count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('Error fetching game history:', err);
    return c.json({ games: [], total: 0, error: String(err) });
  }
});

export default app;
