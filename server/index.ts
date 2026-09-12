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
  GUESS_TIMER_OPTIONS,
  MAX_GUESSES,
  type Difficulty,
  type DuelRule,
  type GuessTimerSeconds,
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
import { MAX_LOBBY_PLAYERS, normalizeLobbyCode } from "../src/duel/protocol.ts";

const PORT = Number(process.env.PORT || 3001);
const legends = legendsData as Legend[];

type Player = {
  id: string;
  name: string;
  ws: WebSocket;
  ready: boolean;
  spectating: boolean;
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
  guessSeconds: GuessTimerSeconds;
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
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

function uniqueCode() {
  for (let i = 0; i < 80; i++) {
    const code = randomCode();
    if (!lobbies.has(code)) return code;
  }
  return randomCode();
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

function activePlayers(lobby: Lobby) {
  return [...lobby.players.values()].filter((player) => !player.spectating);
}

/** Random permutation with no fixed points (nobody receives their own pick). */
function randomDerangement(n: number): number[] {
  if (n < 2) return [...Array(n).keys()];
  const order = [...Array(n).keys()];
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order.every((value, index) => value !== index)) return order;
  }
  return [...Array(n).keys()].map((i) => (i + 1) % n);
}

function publicPlayers(lobby: Lobby, viewerId: string): DuelPlayerPublic[] {
  return [...lobby.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    connected: player.ws.readyState === WebSocket.OPEN,
    ready: player.ready,
    picked: Boolean(player.pick),
    spectating: player.spectating,
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
    guessSeconds: lobby.guessSeconds,
    youAreHost: lobby.hostId === viewerId,
    hostId: lobby.hostId,
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

  const players = activePlayers(lobby);
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

function startTimers(lobby: Lobby) {
  const endsAt = Date.now() + lobby.guessSeconds * 1000;
  for (const player of activePlayers(lobby)) {
    if (!player.finished) player.timerEndsAt = endsAt;
  }
}

function maybeFinish(lobby: Lobby) {
  const players = activePlayers(lobby);
  if (players.length === 0 || players.every((p) => p.finished)) {
    lobby.phase = "finished";
    for (const player of lobby.players.values()) player.timerEndsAt = null;
  }
}

function assignAnswers(lobby: Lobby) {
  const players = activePlayers(lobby);
  if (lobby.rule === "shared") {
    const answer = legends[Math.floor(Math.random() * legends.length)];
    lobby.sharedAnswer = answer.name;
    for (const player of players) player.answer = answer.name;
    return;
  }

  const perm = randomDerangement(players.length);
  for (let i = 0; i < players.length; i++) {
    players[i].answer = players[perm[i]].pick;
  }
}

function clearMatchState(player: Player) {
  player.pick = undefined;
  player.answer = undefined;
  player.rows = [];
  player.guessCount = 0;
  player.solved = false;
  player.finished = false;
  player.timerEndsAt = null;
}

function resetMatch(lobby: Lobby) {
  lobby.phase = "waiting";
  lobby.sharedAnswer = undefined;
  lobby.createdAt = Date.now();
  for (const player of lobby.players.values()) {
    player.ready = false;
    player.spectating = false;
    clearMatchState(player);
  }
}

function makePlayer(ws: WebSocket, id: string, name: string): Player {
  return {
    id,
    name,
    ws,
    ready: false,
    spectating: false,
    rows: [],
    guessCount: 0,
    solved: false,
    finished: false,
    timerEndsAt: null,
  };
}

function createLobby(ws: WebSocket, name?: string) {
  const code = uniqueCode();
  const playerId = crypto.randomUUID();
  const player = makePlayer(ws, playerId, playerName(name, "Host"));

  const lobby: Lobby = {
    code,
    hostId: playerId,
    phase: "waiting",
    rule: "shared",
    difficulty: "easy",
    guessSeconds: DUEL_GUESS_SECONDS,
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
  const code = normalizeLobbyCode(codeRaw);
  if (code.length !== 6) {
    send(ws, { type: "error", message: "Enter a 6-digit lobby code." });
    return;
  }
  const lobby = lobbies.get(code);
  if (!lobby) {
    send(ws, { type: "error", message: "Lobby not found." });
    return;
  }
  if (lobby.phase !== "waiting") {
    send(ws, { type: "error", message: "That lobby already started." });
    return;
  }
  if (lobby.players.size >= MAX_LOBBY_PLAYERS) {
    send(ws, { type: "error", message: "Lobby is full." });
    return;
  }

  const playerId = crypto.randomUUID();
  const player = makePlayer(ws, playerId, playerName(name, `Player ${lobby.players.size + 1}`));

  lobby.players.set(playerId, player);
  socketToLobby.set(ws, code);
  socketToPlayer.set(ws, playerId);
  send(ws, { type: "hello", playerId });
  broadcastLobby(lobby);
}

function handleKick(lobby: Lobby, hostId: string, targetId: string) {
  if (lobby.hostId !== hostId) {
    const host = lobby.players.get(hostId);
    if (host) send(host.ws, { type: "error", message: "Only the host can kick." });
    return;
  }
  if (lobby.phase !== "waiting" && lobby.phase !== "picking") {
    const host = lobby.players.get(hostId);
    if (host) send(host.ws, { type: "error", message: "Cannot kick during a match." });
    return;
  }
  if (targetId === hostId) {
    const host = lobby.players.get(hostId);
    if (host) send(host.ws, { type: "error", message: "You cannot kick yourself." });
    return;
  }

  const target = lobby.players.get(targetId);
  if (!target) return;

  send(target.ws, { type: "gone", message: "You were kicked from the lobby." });
  socketToLobby.delete(target.ws);
  socketToPlayer.delete(target.ws);
  lobby.players.delete(targetId);

  if (lobby.phase === "picking") {
    const remaining = activePlayers(lobby);
    if (remaining.length < 2) {
      resetMatch(lobby);
      broadcastLobby(lobby);
      return;
    }
    const allPicked = remaining.every((p) => p.pick);
    if (allPicked) {
      assignAnswers(lobby);
      lobby.phase = "playing";
      startTimers(lobby);
    }
  }

  broadcastLobby(lobby);
}

function handleSetReady(lobby: Lobby, playerId: string, ready: boolean) {
  if (lobby.phase !== "waiting") return;
  const player = lobby.players.get(playerId);
  if (!player) return;
  player.ready = Boolean(ready);
  broadcastLobby(lobby);
}

function isGuessTimerOption(seconds: number): seconds is GuessTimerSeconds {
  return (GUESS_TIMER_OPTIONS as readonly number[]).includes(seconds);
}

function handleSetGuessSeconds(lobby: Lobby, playerId: string, seconds: number) {
  if (lobby.hostId !== playerId || lobby.phase !== "waiting") return;
  if (!isGuessTimerOption(seconds)) {
    const host = lobby.players.get(playerId);
    if (host) send(host.ws, { type: "error", message: "Invalid guess timer." });
    return;
  }
  lobby.guessSeconds = seconds;
  broadcastLobby(lobby);
}

function handleStart(lobby: Lobby, playerId: string) {
  if (lobby.hostId !== playerId) {
    const host = lobby.players.get(playerId);
    if (host) send(host.ws, { type: "error", message: "Only the host can start." });
    return;
  }

  const ready = [...lobby.players.values()].filter((p) => p.ready);
  if (ready.length < 2) {
    const host = lobby.players.get(playerId);
    if (host) {
      send(host.ws, {
        type: "error",
        message: "Need at least 2 ready players to start.",
      });
    }
    return;
  }

  for (const player of lobby.players.values()) {
    player.spectating = !player.ready;
    clearMatchState(player);
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
  if (!player || player.spectating || player.pick) return;

  const legend = findLegend(legendName);
  if (!legend) {
    send(player.ws, { type: "error", message: "Unknown legend." });
    return;
  }

  player.pick = legend.name;

  const allPicked = activePlayers(lobby).every((p) => p.pick);
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
  if (!player || player.spectating || player.finished || !player.answer) return;

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
    player.timerEndsAt = Date.now() + lobby.guessSeconds * 1000;
  }

  maybeFinish(lobby);
  broadcastLobby(lobby);
}

function applyTimeout(lobby: Lobby, player: Player) {
  if (lobby.phase !== "playing" || player.spectating || player.finished) return;
  const columns = DIFFICULTY_COLUMNS[lobby.difficulty];
  const row = buildTimeoutRow(columns);
  player.rows.push(row);
  player.guessCount = player.rows.length;

  if (player.guessCount >= MAX_GUESSES) {
    finishPlayer(player);
  } else {
    player.timerEndsAt = Date.now() + lobby.guessSeconds * 1000;
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
    case "setGuessSeconds":
      handleSetGuessSeconds(lobby, playerId, message.seconds);
      break;
    case "setReady":
      handleSetReady(lobby, playerId, message.ready);
      break;
    case "kick":
      handleKick(lobby, playerId, message.playerId);
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

function promoteHost(lobby: Lobby) {
  const next = [...lobby.players.values()][0];
  if (next) lobby.hostId = next.id;
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
    if (lobby.players.size === 0) {
      destroyLobby(code);
      return;
    }
    if (playerId === lobby.hostId) {
      for (const remaining of lobby.players.values()) {
        send(remaining.ws, { type: "gone", message: "Host left. Lobby closed." });
        socketToLobby.delete(remaining.ws);
        socketToPlayer.delete(remaining.ws);
      }
      destroyLobby(code);
      return;
    }

    if (lobby.phase === "picking") {
      const remaining = activePlayers(lobby);
      if (remaining.length < 2) {
        resetMatch(lobby);
        broadcastLobby(lobby);
        return;
      }
      const allPicked = remaining.every((p) => p.pick);
      if (allPicked) {
        assignAnswers(lobby);
        lobby.phase = "playing";
        startTimers(lobby);
      }
    }

    broadcastLobby(lobby);
    return;
  }

  if (lobby.phase === "finished") {
    lobby.players.delete(playerId);
    if (lobby.players.size === 0) {
      destroyLobby(code);
      return;
    }
    if (playerId === lobby.hostId) promoteHost(lobby);
    broadcastLobby(lobby);
    return;
  }

  const player = lobby.players.get(playerId);
  if (player && !player.spectating && !player.finished) {
    player.finished = true;
    player.timerEndsAt = null;
    maybeFinish(lobby);
  }
  if (playerId === lobby.hostId) promoteHost(lobby);
  broadcastLobby(lobby);
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Brawldle battle websocket server");
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
    for (const player of activePlayers(lobby)) {
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
  console.log(`Battle WebSocket server on ws://localhost:${PORT}`);
});
