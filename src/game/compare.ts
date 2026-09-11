import type { ColumnId, Hint, Legend, PrivateGuessRow, PublicCell, PublicGuessRow } from "./types";

export function compareText(value: string, target: string): Hint {
  return value === target ? "green" : "grey";
}

export function compareWeapon(
  value: string,
  targetPrimary: string,
  targetSecondary: string,
): Hint {
  if (value === targetPrimary) return "green";
  if (value === targetSecondary) return "yellow";
  return "grey";
}

export function compareYear(value: number, target: number): Hint {
  if (value === target) return "green";
  return Math.abs(value - target) <= 2 ? "yellow" : "grey";
}

export function compareStat(value: number, target: number): Hint {
  if (value === target) return "green";
  return Math.abs(value - target) <= 1 ? "yellow" : "grey";
}

export function buildGuessRow(
  guess: Legend,
  answer: Legend,
  columns: ColumnId[],
): PrivateGuessRow {
  const cells: PublicCell[] = columns.map((column) => {
    switch (column) {
      case "name":
        return { column, hint: compareText(guess.name, answer.name) };
      case "gender":
        return { column, hint: compareText(guess.gender, answer.gender) };
      case "weapon1":
        return {
          column,
          hint: compareWeapon(guess.weapon1, answer.weapon1, answer.weapon2),
        };
      case "weapon2":
        return {
          column,
          hint: compareWeapon(guess.weapon2, answer.weapon2, answer.weapon1),
        };
      case "year": {
        const hint = compareYear(guess.year, answer.year);
        return {
          column,
          hint,
          yearArrow:
            guess.year === answer.year ? undefined : guess.year < answer.year ? "up" : "down",
        };
      }
      case "stats":
        return {
          column: "stats",
          hints: guess.stats.map((value, index) => compareStat(value, answer.stats[index])),
        };
    }
  });

  return {
    cells,
    solved: guess.name === answer.name,
    legendName: guess.name,
    year: guess.year,
    gender: guess.gender,
    weapon1: guess.weapon1,
    weapon2: guess.weapon2,
    stats: guess.stats,
  };
}

export function buildTimeoutRow(columns: ColumnId[]): PrivateGuessRow {
  const cells: PublicCell[] = columns.map((column) => {
    if (column === "stats") {
      return { column: "stats", hints: ["grey", "grey", "grey", "grey"] };
    }
    return { column, hint: "grey" };
  });
  return { cells, solved: false, timedOut: true };
}

export function toPublicRow(row: PrivateGuessRow): PublicGuessRow {
  return {
    cells: row.cells,
    timedOut: row.timedOut,
    solved: row.solved,
  };
}
