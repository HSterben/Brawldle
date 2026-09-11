export type Legend = {
  name: string;
  gender: string;
  weapon1: string;
  weapon2: string;
  year: number;
  stats: [number, number, number, number];
};

export type Hint = "green" | "yellow" | "grey";
export type Difficulty = "easy" | "medium" | "hard";
export type ColumnId = "name" | "gender" | "weapon1" | "weapon2" | "year" | "stats";
export type DuelRule = "shared" | "pick";

export const MAX_GUESSES = 8;
export const DUEL_GUESS_SECONDS = 25;
export const STAT_LABELS = ["STR", "DEX", "DEF", "SPD"] as const;

export const COLUMN_LABELS: Record<ColumnId, string> = {
  name: "Legend",
  gender: "Gender",
  weapon1: "Weapon 1",
  weapon2: "Weapon 2",
  year: "Year",
  stats: "Stats",
};

export const DIFFICULTY_COLUMNS: Record<Difficulty, ColumnId[]> = {
  easy: ["name", "gender", "weapon1", "weapon2", "year", "stats"],
  medium: ["name", "weapon1", "weapon2", "year"],
  hard: ["name", "weapon1", "weapon2"],
};

export type PublicCell =
  | { column: Exclude<ColumnId, "stats">; hint: Hint; yearArrow?: "up" | "down" }
  | { column: "stats"; hints: Hint[] };

export type PublicGuessRow = {
  cells: PublicCell[];
  timedOut?: boolean;
  solved: boolean;
};

export type PrivateGuessRow = PublicGuessRow & {
  legendName?: string;
  year?: number;
  gender?: string;
  weapon1?: string;
  weapon2?: string;
  stats?: [number, number, number, number];
};
