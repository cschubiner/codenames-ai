/**
 * Codenames AI Worker - API routes
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Re-export the Durable Object
export { GameRoom } from './game';

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  OPENAI_API_KEY?: string;
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

  const data = await response.json();
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

  const data = await response.json();
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

  const data = await response.json();
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

  const data = await response.json();
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

export default app;
