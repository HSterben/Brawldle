import type {
  Difficulty,
  DuelRule,
  Legend,
  PrivateGuessRow,
  PublicGuessRow,
} from "../game/types";

export type DuelPhase = "waiting" | "picking" | "playing" | "finished";

export type DuelPlayerPublic = {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  picked: boolean;
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
