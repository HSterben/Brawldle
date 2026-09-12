import type {
  Difficulty,
  DuelRule,
  GuessTimerSeconds,
  Legend,
  PrivateGuessRow,
  PublicGuessRow,
} from "../game/types";

export type DuelPhase = "waiting" | "picking" | "playing" | "finished";

export const MAX_LOBBY_PLAYERS = 8;

/** Keep digits only (ignores # and other characters). */
export function normalizeLobbyCode(raw: string): string {
  return String(raw || "").replace(/\D/g, "").slice(0, 6);
}

/** Display form, e.g. #482917 */
export function formatLobbyCode(code: string): string {
  const digits = normalizeLobbyCode(code);
  return digits ? `#${digits}` : "";
}

export type DuelPlayerPublic = {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  picked: boolean;
  spectating: boolean;
  guessCount: number;
  solved: boolean;
  finished: boolean;
  rows: PublicGuessRow[];
  timerEndsAt: number | null;
};

export type DuelLobbyPublic = {
  code: string;
  phase: DuelPhase;
  rule: DuelRule;
  difficulty: Difficulty;
  guessSeconds: GuessTimerSeconds;
  youAreHost: boolean;
  hostId: string;
  yourId: string;
  players: DuelPlayerPublic[];
  yourAnswer: Legend | null;
  yourPrivateRows: PrivateGuessRow[];
  winnerId: string | null;
  draw: boolean;
  invitePath: string;
};

export type ClientMessage =
  | { type: "create"; name?: string }
  | { type: "join"; code: string; name?: string }
  | { type: "setRule"; rule: DuelRule }
  | { type: "setDifficulty"; difficulty: Difficulty }
  | { type: "setGuessSeconds"; seconds: GuessTimerSeconds }
  | { type: "setReady"; ready: boolean }
  | { type: "kick"; playerId: string }
  | { type: "start" }
  | { type: "pick"; legendName: string }
  | { type: "guess"; legendName: string }
  | { type: "rematch" }
  | { type: "leave" };

export type ServerMessage =
  | { type: "hello"; playerId: string }
  | { type: "lobby"; lobby: DuelLobbyPublic }
  | { type: "error"; message: string }
  | { type: "gone"; message: string };
