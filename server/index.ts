import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import legendsData from "../data/legends.json" with { type: "json" };
import {
  buildGuessRow,
  buildTimeoutRow,
  toPublicRow,
} from "../src/game/compare.ts";
import {
  DIFFICULTY_COLUMNS,
  DUEL_GUESS_SECONDS,
  MAX_GUESSES,
  type Difficulty,
  type DuelRule,
  type Legend,
  type PrivateGuessRow,
} from "../src/game/types.ts";
import type {
  ClientMessage,
  DuelLobbyPublic,
  DuelPhase,
  DuelPlayerPublic,
  ServerMessage,
} from "../src/duel/protocol.ts";

const PORT = Number(process.env.PORT || 3001);
const legends = legendsData as Legend[];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Player = {
  id: string;
  name: string;
  ws: WebSocket;
  ready: boolean;
  pick?: string;
  answer?: string;
  rows: PrivateGuessRow[];
  guessCount: number;
  solved: boolean;
  finished: boolean;
  timerEndsAt: number | null;
};

type Lobby = {
  code: string;
  hostId: string;
  phase: DuelPhase;
  rule: DuelRule;
  difficulty: Difficulty;
  players: Map<string, Player>;
  sharedAnswer?: string;
  createdAt: number;
};

const lobbies = new Map<string, Lobby>();
const socketToLobby = new Map<WebSocket, string>();
const socketToPlayer = new Map<WebSocket, string>();

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function randomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function uniqueCode() {
  for (let i = 0; i < 40; i++) {
    const code = randomCode();
    if (!lobbies.has(code)) return code;
  }
  return `${randomCode()}${randomCode()}`.slice(0, 6);
}

function playerName(preferred?: string, fallback = "Player") {
  const cleaned = (preferred || "").trim().slice(0, 16);
  return cleaned || fallback;
}

function findLegend(name: string) {
  const normalized = name.trim().toLowerCase();
  return legends.find((legend) => legend.name.toLowerCase() === normalized);
}

function destroyLobby(code: string) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  for (const player of lobby.players.values()) {
    socketToLobby.delete(player.ws);
    socketToPlayer.delete(player.ws);
  }
  lobbies.delete(code);
}

function publicPlayers(lobby: Lobby, viewerId: string): DuelPlayerPublic[] {
  return [...lobby.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    connected: player.ws.readyState === WebSocket.OPEN,
    ready: player.ready,
    picked: Boolean(player.pick),
    guessCount: player.guessCount,
    solved: player.solved,
    finished: player.finished,
    rows:
      player.id === viewerId
        ? player.rows.map(toPublicRow)
        : player.rows.map((row) => toPublicRow(row)),
    timerEndsAt: player.timerEndsAt,
  }));
}

function lobbyPayload(lobby: Lobby, viewerId: string): DuelLobbyPublic {
  const you = lobby.players.get(viewerId);
  const answerName = you?.answer;
  const yourAnswer = answerName ? findLegend(answerName) || null : null;

  return {
    code: lobby.code,
    phase: lobby.phase,
    rule: lobby.rule,
    difficulty: lobby.difficulty,
    youAreHost: lobby.hostId === viewerId,
    yourId: viewerId,
    players: publicPlayers(lobby, viewerId),
    yourAnswer: lobby.phase === "finished" ? yourAnswer : null,
    yourPrivateRows: you?.rows || [],
    winnerId: null,
    draw: false,
    invitePath: `?duel=${lobby.code}`,
  };
}

function withResult(lobby: Lobby, viewerId: string): DuelLobbyPublic {
  const payload = lobbyPayload(lobby, viewerId);
  if (lobby.phase !== "finished") return payload;

  const players = [...lobby.players.values()];
  const solvers = players.filter((p) => p.solved);
  if (solvers.length === 0) {
    payload.draw = true;
    return payload;
  }
  if (solvers.length === 1) {
    payload.winnerId = solvers[0].id;
    return payload;
  }

  const best = Math.min(...solvers.map((p) => p.guessCount));
  const winners = solvers.filter((p) => p.guessCount === best);
  if (winners.length === 1) {
    payload.winnerId = winners[0].id;
  } else {
    payload.draw = true;
  }
  return payload;
}

function broadcastLobby(lobby: Lobby) {
  for (const player of lobby.players.values()) {
    send(player.ws, { type: "lobby", lobby: withResult(lobby, player.id) });
  }
}

function bothConnected(lobby: Lobby) {
  return lobby.players.size === 2;
}

function startTimers(lobby: Lobby) {
  const endsAt = Date.now() + DUEL_GUESS_SECONDS * 1000;
  for (const player of lobby.players.values()) {
    if (!player.finished) player.timerEndsAt = endsAt;
  }
}

function maybeFinish(lobby: Lobby) {
  const players = [...lobby.players.values()];
  if (players.every((p) => p.finished)) {
    lobby.phase = "finished";
    for (const player of players) player.timerEndsAt = null;
  }
}

function assignAnswers(lobby: Lobby) {
  const players = [...lobby.players.values()];
  if (lobby.rule === "shared") {
    const answer = legends[Math.floor(Math.random() * legends.length)];
    lobby.sharedAnswer = answer.name;
    for (const player of players) player.answer = answer.name;
    return;
  }

  const [a, b] = players;
  a.answer = b.pick;
  b.answer = a.pick;
}

function resetMatch(lobby: Lobby) {
  lobby.phase = "waiting";
  lobby.sharedAnswer = undefined;
  lobby.createdAt = Date.now();
  for (const player of lobby.players.values()) {
    player.ready = false;
    player.pick = undefined;
    player.answer = undefined;
    player.rows = [];
    player.guessCount = 0;
    player.solved = false;
    player.finished = false;
    player.timerEndsAt = null;
  }
}

function createLobby(ws: WebSocket, name?: string) {
  const code = uniqueCode();
  const playerId = crypto.randomUUID();
  const player: Player = {
    id: playerId,
    name: playerName(name, "Host"),
    ws,
    ready: false,
    rows: [],
    guessCount: 0,
    solved: false,
    finished: false,
    timerEndsAt: null,
  };

  const lobby: Lobby = {
    code,
    hostId: playerId,
    phase: "waiting",
    rule: "shared",
    difficulty: "easy",
    players: new Map([[playerId, player]]),
    createdAt: Date.now(),
  };

  lobbies.set(code, lobby);
  socketToLobby.set(ws, code);
  socketToPlayer.set(ws, playerId);
  send(ws, { type: "hello", playerId });
  broadcastLobby(lobby);
}

function joinLobby(ws: WebSocket, codeRaw: string, name?: string) {
  const code = codeRaw.trim().toUpperCase();
  const lobby = lobbies.get(code);
  if (!lobby) {
    send(ws, { type: "error", message: "Lobby not found." });
    return;
  }
  if (lobby.phase !== "waiting") {
    send(ws, { type: "error", message: "That lobby already started." });
    return;
  }
  if (lobby.players.size >= 2) {
    send(ws, { type: "error", message: "Lobby is full." });
    return;
  }

  const playerId = crypto.randomUUID();
  const player: Player = {
    id: playerId,
    name: playerName(name, "Guest"),
    ws,
    ready: false,
    rows: [],
    guessCount: 0,
    solved: false,
    finished: false,
    timerEndsAt: null,
  };

  lobby.players.set(playerId, player);
  socketToLobby.set(ws, code);
  socketToPlayer.set(ws, playerId);
  send(ws, { type: "hello", playerId });
  broadcastLobby(lobby);
}

function handleStart(lobby: Lobby, playerId: string) {
  if (lobby.hostId !== playerId) {
    const host = lobby.players.get(playerId);
    if (host) send(host.ws, { type: "error", message: "Only the host can start." });
    return;
  }
  if (!bothConnected(lobby)) {
    const host = lobby.players.get(playerId);
    if (host) send(host.ws, { type: "error", message: "Need a second player first." });
    return;
  }

  for (const player of lobby.players.values()) {
    player.ready = false;
    player.pick = undefined;
    player.answer = undefined;
    player.rows = [];
    player.guessCount = 0;
    player.solved = false;
    player.finished = false;
    player.timerEndsAt = null;
  }

  if (lobby.rule === "pick") {
    lobby.phase = "picking";
  } else {
    assignAnswers(lobby);
    lobby.phase = "playing";
    startTimers(lobby);
  }
  broadcastLobby(lobby);
}

function handlePick(lobby: Lobby, playerId: string, legendName: string) {
  if (lobby.phase !== "picking") return;
  const player = lobby.players.get(playerId);
  if (!player || player.pick) return;

  const legend = findLegend(legendName);
  if (!legend) {
    send(player.ws, { type: "error", message: "Unknown legend." });
    return;
  }

  player.pick = legend.name;

  const allPicked = [...lobby.players.values()].every((p) => p.pick);
  if (allPicked) {
    assignAnswers(lobby);
    lobby.phase = "playing";
    startTimers(lobby);
  }
  broadcastLobby(lobby);
}

function finishPlayer(player: Player) {
  player.finished = true;
  player.timerEndsAt = null;
}

function handleGuess(lobby: Lobby, playerId: string, legendName: string) {
  if (lobby.phase !== "playing") return;
  const player = lobby.players.get(playerId);
  if (!player || player.finished || !player.answer) return;

  const legend = findLegend(legendName);
  if (!legend) {
    send(player.ws, { type: "error", message: "Unknown legend." });
    return;
  }

  if (player.rows.some((row) => row.legendName?.toLowerCase() === legend.name.toLowerCase())) {
    send(player.ws, { type: "error", message: "Already guessed that legend." });
    return;
  }

  const answer = findLegend(player.answer);
  if (!answer) return;

  const columns = DIFFICULTY_COLUMNS[lobby.difficulty];
  const row = buildGuessRow(legend, answer, columns);
  player.rows.push(row);
  player.guessCount = player.rows.length;

  if (row.solved) {
    player.solved = true;
    finishPlayer(player);
  } else if (player.guessCount >= MAX_GUESSES) {
    finishPlayer(player);
  } else {
    player.timerEndsAt = Date.now() + DUEL_GUESS_SECONDS * 1000;
  }

  maybeFinish(lobby);
  broadcastLobby(lobby);
}

function applyTimeout(lobby: Lobby, player: Player) {
  if (lobby.phase !== "playing" || player.finished) return;
  const columns = DIFFICULTY_COLUMNS[lobby.difficulty];
  const row = buildTimeoutRow(columns);
  player.rows.push(row);
  player.guessCount = player.rows.length;

  if (player.guessCount >= MAX_GUESSES) {
    finishPlayer(player);
  } else {
    player.timerEndsAt = Date.now() + DUEL_GUESS_SECONDS * 1000;
  }

  maybeFinish(lobby);
  broadcastLobby(lobby);
}

function handleMessage(ws: WebSocket, raw: string) {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(ws, { type: "error", message: "Invalid message." });
    return;
  }

  if (message.type === "create") {
    createLobby(ws, message.name);
    return;
  }

  if (message.type === "join") {
    joinLobby(ws, message.code, message.name);
    return;
  }

  const code = socketToLobby.get(ws);
  const playerId = socketToPlayer.get(ws);
  if (!code || !playerId) {
    send(ws, { type: "error", message: "Join or create a lobby first." });
    return;
  }

  const lobby = lobbies.get(code);
  if (!lobby) {
    send(ws, { type: "error", message: "Lobby gone." });
    return;
  }

  switch (message.type) {
    case "setRule":
      if (lobby.hostId === playerId && lobby.phase === "waiting") {
        lobby.rule = message.rule;
        broadcastLobby(lobby);
      }
      break;
    case "setDifficulty":
      if (lobby.hostId === playerId && lobby.phase === "waiting") {
        lobby.difficulty = message.difficulty;
        broadcastLobby(lobby);
      }
      break;
    case "start":
      handleStart(lobby, playerId);
      break;
    case "pick":
      handlePick(lobby, playerId, message.legendName);
      break;
    case "guess":
      handleGuess(lobby, playerId, message.legendName);
      break;
    case "rematch":
      if (lobby.hostId === playerId && lobby.phase === "finished") {
        resetMatch(lobby);
        broadcastLobby(lobby);
      }
      break;
    case "leave":
      detachSocket(ws, true);
      break;
  }
}

function detachSocket(ws: WebSocket, _notifyGone: boolean) {
  const code = socketToLobby.get(ws);
  const playerId = socketToPlayer.get(ws);
  socketToLobby.delete(ws);
  socketToPlayer.delete(ws);
  if (!code || !playerId) return;

  const lobby = lobbies.get(code);
  if (!lobby) return;

  if (lobby.phase === "waiting" || lobby.phase === "picking") {
    lobby.players.delete(playerId);
    if (lobby.players.size === 0 || playerId === lobby.hostId) {
      for (const remaining of lobby.players.values()) {
        send(remaining.ws, { type: "gone", message: "Host left. Lobby closed." });
        socketToLobby.delete(remaining.ws);
        socketToPlayer.delete(remaining.ws);
      }
      destroyLobby(code);
      return;
    }
    const [remaining] = lobby.players.values();
    lobby.hostId = remaining.id;
    broadcastLobby(lobby);
    return;
  }

  if (lobby.phase === "finished") {
    lobby.players.delete(playerId);
    if (lobby.players.size === 0) destroyLobby(code);
    else broadcastLobby(lobby);
    return;
  }

  const player = lobby.players.get(playerId);
  if (player && !player.finished) {
    player.finished = true;
    player.timerEndsAt = null;
    maybeFinish(lobby);
    broadcastLobby(lobby);
  }
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Brawldle duel websocket server");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (data) => handleMessage(ws, String(data)));
  ws.on("close", () => detachSocket(ws, false));
  ws.on("error", () => detachSocket(ws, false));
});

setInterval(() => {
  const now = Date.now();
  for (const lobby of lobbies.values()) {
    if (lobby.phase !== "playing") continue;
    for (const player of lobby.players.values()) {
      if (player.finished || !player.timerEndsAt) continue;
      if (now >= player.timerEndsAt) applyTimeout(lobby, player);
    }
  }

  for (const [code, lobby] of lobbies) {
    const idleMs = now - lobby.createdAt;
    if (lobby.players.size === 0) destroyLobby(code);
    else if (lobby.phase === "finished" && idleMs > 1000 * 60 * 30) destroyLobby(code);
    else if (lobby.phase === "waiting" && idleMs > 1000 * 60 * 60) destroyLobby(code);
  }
}, 250);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other duel server (or whatever is on ${PORT}), then retry.`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Duel WebSocket server on ws://localhost:${PORT}`);
});
