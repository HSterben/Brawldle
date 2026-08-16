import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import legendsData from "../data/legends.json";

gsap.registerPlugin(useGSAP);

type Legend = {
  name: string;
  gender: string;
  weapon1: string;
  weapon2: string;
  year: number;
  stats: [number, number, number, number];
};

type Hint = "green" | "yellow" | "grey";
type GameMode = "daily" | "unlimited";
type Difficulty = "easy" | "medium" | "hard";
type ColumnId = "name" | "gender" | "weapon1" | "weapon2" | "year" | "stats";

type DailySave = {
  dateKey: string;
  guesses: string[];
  gameOver: boolean;
  won: boolean;
};

const MAX_GUESSES = 8;
const STAT_LABELS = ["STR", "DEX", "DEF", "SPD"];
const legends = legendsData as Legend[];

const COLUMN_LABELS: Record<ColumnId, string> = {
  name: "Legend",
  gender: "Gender",
  weapon1: "Weapon 1",
  weapon2: "Weapon 2",
  year: "Year",
  stats: "Stats",
};

/** Easy = full board. Medium drops Gender + Year. Hard keeps weapons only. */
const DIFFICULTY_COLUMNS: Record<Difficulty, ColumnId[]> = {
  easy: ["name", "gender", "weapon1", "weapon2", "year", "stats"],
  medium: ["name", "weapon1", "weapon2", "stats"],
  hard: ["name", "weapon1", "weapon2"],
};

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Deterministic PRNG from an integer seed (Mulberry32). */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDateKey(dateKey: string) {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getRandomLegend() {
  return legends[Math.floor(Math.random() * legends.length)];
}

function getDailyLegend(dateKey: string) {
  const rand = mulberry32(seedFromDateKey(dateKey));
  const index = Math.floor(rand() * legends.length);
  return legends[index];
}

function dailyStorageKey(dateKey: string, difficulty: Difficulty) {
  return `brawldle-daily-${dateKey}-${difficulty}`;
}

function loadDailySave(dateKey: string, difficulty: Difficulty): DailySave | null {
  try {
    const raw = localStorage.getItem(dailyStorageKey(dateKey, difficulty));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailySave;
    if (parsed.dateKey !== dateKey || !Array.isArray(parsed.guesses)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDailyProgress(dateKey: string, difficulty: Difficulty, save: DailySave) {
  localStorage.setItem(dailyStorageKey(dateKey, difficulty), JSON.stringify(save));
}

function legendsFromNames(names: string[]) {
  return names
    .map((name) => legends.find((legend) => legend.name === name))
    .filter((legend): legend is Legend => Boolean(legend));
}

function msUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function App() {
  const [mode, setMode] = useState<GameMode>("daily");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [dateKey, setDateKey] = useState(() => getLocalDateKey());

  const [answer, setAnswer] = useState<Legend>(() => getDailyLegend(getLocalDateKey()));
  const [guessInput, setGuessInput] = useState("");
  const [guesses, setGuesses] = useState<Legend[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [shakeInput, setShakeInput] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [countdown, setCountdown] = useState(() => formatCountdown(msUntilNextLocalMidnight()));
  const [modeSwitching, setModeSwitching] = useState(false);

  const appRef = useRef<HTMLDivElement>(null);
  const modeStageRef = useRef<HTMLDivElement>(null);
  const modeFlashRef = useRef<HTMLDivElement>(null);
  const modeDirRef = useRef(1);
  const prevModeRef = useRef<GameMode | null>(null);

  const columns = DIFFICULTY_COLUMNS[difficulty];

  const guessedNames = useMemo(
    () => new Set(guesses.map((g) => g.name.toLowerCase())),
    [guesses],
  );

  const filteredLegends = useMemo(() => {
    const query = guessInput.trim().toLowerCase();
    if (!query) return [];
    return legends
      .filter(
        (legend) =>
          legend.name.toLowerCase().includes(query) &&
          !guessedNames.has(legend.name.toLowerCase()),
      )
      .slice(0, 8);
  }, [guessInput, guessedNames]);

  useEffect(() => {
    setShowAutocomplete(filteredLegends.length > 0 && guessInput.length > 0);
    setActiveIndex(0);
  }, [filteredLegends.length, guessInput.length]);

  useEffect(() => {
    const syncDate = () => {
      const nextKey = getLocalDateKey();
      setDateKey((prev) => (prev === nextKey ? prev : nextKey));
    };
    syncDate();
    const id = window.setInterval(syncDate, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (mode !== "daily" || !gameOver) return;
    const tick = () => setCountdown(formatCountdown(msUntilNextLocalMidnight()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [mode, gameOver]);

  useEffect(() => {
    if (mode === "daily") {
      const saved = loadDailySave(dateKey, difficulty);
      const dailyAnswer = getDailyLegend(dateKey);
      setAnswer(dailyAnswer);
      if (saved) {
        setGuesses(legendsFromNames(saved.guesses));
        setGameOver(saved.gameOver);
        setWon(saved.won);
      } else {
        setGuesses([]);
        setGameOver(false);
        setWon(false);
      }
    } else {
      setAnswer(getRandomLegend());
      setGuesses([]);
      setGameOver(false);
      setWon(false);
    }
    setGuessInput("");
    setShowAutocomplete(false);
    setShakeInput(false);
    setActiveIndex(0);
  }, [mode, difficulty, dateKey]);

  const { contextSafe } = useGSAP({ scope: appRef });

  useGSAP(
    () => {
      const stage = modeStageRef.current;
      const flash = modeFlashRef.current;
      const isFirst = prevModeRef.current === null;
      const modeChanged = prevModeRef.current !== null && prevModeRef.current !== mode;
      prevModeRef.current = mode;

      if (!stage || isFirst || !modeChanged) {
        if (stage) gsap.set(stage, { clearProps: "transform,opacity,filter" });
        if (flash) gsap.set(flash, { autoAlpha: 0, scale: 1.1 });
        setModeSwitching(false);
        return;
      }

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        gsap.set(stage, { clearProps: "transform,opacity,filter" });
        if (flash) gsap.set(flash, { autoAlpha: 0 });
        setModeSwitching(false);
        return;
      }

      const dir = modeDirRef.current;
      const tl = gsap.timeline({
        onComplete: () => setModeSwitching(false),
      });

      if (flash) {
        tl.fromTo(
          flash,
          { autoAlpha: 0, scale: 1.18, y: 18 * dir },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: "power3.out" },
        ).to(flash, {
          autoAlpha: 0,
          scale: 0.92,
          y: -12 * dir,
          duration: 0.28,
          ease: "power2.in",
          delay: 0.12,
        });
      }

      tl.fromTo(
        stage,
        {
          opacity: 0,
          x: 48 * dir,
          y: 16,
          rotateY: -8 * dir,
          scale: 0.94,
          filter: "blur(10px)",
        },
        {
          opacity: 1,
          x: 0,
          y: 0,
          rotateY: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.55,
          ease: "power3.out",
        },
        "-=0.18",
      );
    },
    { dependencies: [mode], scope: appRef },
  );

  const requestMode = contextSafe((next: GameMode) => {
    if (next === mode || modeSwitching) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dir = next === "unlimited" ? 1 : -1;
    modeDirRef.current = dir;

    if (reduced) {
      setMode(next);
      return;
    }

    const stage = modeStageRef.current;
    if (!stage) {
      setMode(next);
      return;
    }

    setModeSwitching(true);
    gsap.to(stage, {
      opacity: 0,
      x: -42 * dir,
      y: -8,
      rotateY: 6 * dir,
      scale: 0.95,
      filter: "blur(8px)",
      duration: 0.28,
      ease: "power2.in",
      onComplete: () => setMode(next),
    });
  });

  const persistDaily = (
    nextGuesses: Legend[],
    nextGameOver: boolean,
    nextWon: boolean,
  ) => {
    if (mode !== "daily") return;
    saveDailyProgress(dateKey, difficulty, {
      dateKey,
      guesses: nextGuesses.map((g) => g.name),
      gameOver: nextGameOver,
      won: nextWon,
    });
  };

  const compareText = (value: string, target: string): Hint =>
    value === target ? "green" : "grey";

  const compareWeapon = (value: string, targetPrimary: string, targetSecondary: string): Hint => {
    if (value === targetPrimary) return "green";
    if (value === targetSecondary) return "yellow";
    return "grey";
  };

  const compareYear = (value: number, target: number): Hint => {
    if (value === target) return "green";
    return Math.abs(value - target) <= 2 ? "yellow" : "grey";
  };

  const compareStat = (value: number, target: number): Hint => {
    if (value === target) return "green";
    return Math.abs(value - target) <= 1 ? "yellow" : "grey";
  };

  const triggerShake = () => {
    setShakeInput(true);
    window.setTimeout(() => setShakeInput(false), 350);
  };

  const submitGuessByName = (rawName: string) => {
    if (gameOver) return;
    const normalized = rawName.trim().toLowerCase();
    if (!normalized) return;

    const legend = legends.find((item) => item.name.toLowerCase() === normalized);
    if (!legend || guessedNames.has(legend.name.toLowerCase())) {
      triggerShake();
      return;
    }

    const nextGuesses = [...guesses, legend];
    const hasWon = legend.name === answer.name;
    const outOfGuesses = nextGuesses.length >= MAX_GUESSES;
    const nextGameOver = hasWon || outOfGuesses;

    setGuesses(nextGuesses);
    setGuessInput("");
    setShowAutocomplete(false);

    if (nextGameOver) {
      setGameOver(true);
      setWon(hasWon);
    }

    persistDaily(nextGuesses, nextGameOver, hasWon);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filteredLegends.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      setShowAutocomplete(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (showAutocomplete && filteredLegends[activeIndex]) {
        submitGuessByName(filteredLegends[activeIndex].name);
      } else {
        submitGuessByName(guessInput);
      }
    }
  };

  const resetUnlimited = () => {
    setAnswer(getRandomLegend());
    setGuessInput("");
    setGuesses([]);
    setActiveIndex(0);
    setShowAutocomplete(false);
    setShakeInput(false);
    setGameOver(false);
    setWon(false);
  };

  const renderColumn = (column: ColumnId, guess: Legend, keyPrefix: string) => {
    switch (column) {
      case "name":
        return (
          <div
            key={`${keyPrefix}-name`}
            className={`cell cell-name hint-${compareText(guess.name, answer.name)}`}
          >
            {guess.name}
          </div>
        );
      case "gender":
        return (
          <div
            key={`${keyPrefix}-gender`}
            className={`cell hint-${compareText(guess.gender, answer.gender)}`}
          >
            {guess.gender}
          </div>
        );
      case "weapon1":
        return (
          <div
            key={`${keyPrefix}-weapon1`}
            className={`cell hint-${compareWeapon(guess.weapon1, answer.weapon1, answer.weapon2)}`}
          >
            <span className="weapon-icon">{guess.weapon1}</span>
          </div>
        );
      case "weapon2":
        return (
          <div
            key={`${keyPrefix}-weapon2`}
            className={`cell hint-${compareWeapon(guess.weapon2, answer.weapon2, answer.weapon1)}`}
          >
            <span className="weapon-icon">{guess.weapon2}</span>
          </div>
        );
      case "year":
        return (
          <div
            key={`${keyPrefix}-year`}
            className={`cell hint-${compareYear(guess.year, answer.year)} year-cell`}
          >
            <span>{guess.year}</span>
            {guess.year !== answer.year && (
              <span className="year-arrow">{guess.year < answer.year ? "▲" : "▼"}</span>
            )}
          </div>
        );
      case "stats":
        return (
          <div key={`${keyPrefix}-stats`} className="cell stats-shell">
            <div className="stats-group">
              {guess.stats.map((value, index) => {
                const target = answer.stats[index];
                const hint = compareStat(value, target);
                return (
                  <div className={`stat-cell hint-${hint}`} key={`${keyPrefix}-stat-${index}`}>
                    <span className="stat-label">{STAT_LABELS[index]}</span>
                    <span>
                      {value}
                      {value !== target ? (value < target ? " ▲" : " ▼") : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
    }
  };

  return (
    <div id="app" ref={appRef} data-mode={mode} className={`mode-${mode}`}>
      <header>
        <h1>BRAWLDLE</h1>
      </header>

      <div className="mode-select" role="group" aria-label="Game mode">
        <button
          type="button"
          className={`mode-card ${mode === "daily" ? "active" : ""}`}
          onClick={() => requestMode("daily")}
          disabled={modeSwitching}
        >
          <span className="mode-card-kicker">Challenge</span>
          <span className="mode-card-title">Daily</span>
          <span className="mode-card-copy">Resets at midnight.</span>
        </button>
        <button
          type="button"
          className={`mode-card ${mode === "unlimited" ? "active" : ""}`}
          onClick={() => requestMode("unlimited")}
          disabled={modeSwitching}
        >
          <span className="mode-card-kicker">Free play</span>
          <span className="mode-card-title">Unlimited</span>
          <span className="mode-card-copy">Endless rounds.</span>
        </button>
      </div>

      <div className="controls">
        <p className="difficulty-label">Difficulty</p>
        <div className="control-group" role="group" aria-label="Difficulty">
          {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
            <button
              key={level}
              type="button"
              className={`control-btn ${difficulty === level ? "active" : ""}`}
              onClick={() => setDifficulty(level)}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="mode-flash" ref={modeFlashRef} aria-hidden="true">
        <span className="mode-flash-kicker">{mode === "daily" ? "Challenge" : "Free play"}</span>
        <span className="mode-flash-title">{mode === "daily" ? "Daily" : "Unlimited"}</span>
      </div>

      <div className="mode-stage" ref={modeStageRef}>
        <div className="mode-banner">
          <div className="mode-banner-text">
            <p className="mode-banner-kicker">
              {mode === "daily" ? "Today's challenge" : "Free play arena"}
            </p>
            <h2 className="mode-banner-title">{mode === "daily" ? "Daily" : "Unlimited"}</h2>

          </div>
          {mode === "daily" ? (
            <div className="mode-banner-badge" aria-hidden="true">
              <span className="badge-day">{dateKey.slice(8)}</span>
              <span className="badge-month">
                {new Date(`${dateKey}T12:00:00`).toLocaleString("en-US", { month: "short" })}
              </span>
            </div>
          ) : (
            <div className="mode-banner-badge infinite" aria-hidden="true">
              <span className="badge-infinity">∞</span>
              <span className="badge-month">Rounds</span>
            </div>
          )}
        </div>

        <div id="game-area">
          <div className={`guess-row header-row cols-${columns.length}`}>
            {columns.map((column) => (
              <div
                key={column}
                className={`cell ${column === "name" ? "cell-name" : ""} ${
                  column === "stats" ? "cell-stats" : ""
                }`}
              >
                {COLUMN_LABELS[column]}
              </div>
            ))}
          </div>

          <div id="guesses">
            {guesses.map((guess) => {
              const isCorrect = guess.name === answer.name;
              return (
                <div
                  key={guess.name}
                  className={`guess-row cols-${columns.length} ${isCorrect ? "correct" : ""}`}
                >
                  {columns.map((column) => renderColumn(column, guess, guess.name))}
                </div>
              );
            })}
          </div>

          <div className="guess-counter">
            {guesses.length} / {MAX_GUESSES} guesses
          </div>
        </div>

        {gameOver && (
          <div id="result-banner">
            <div id="result-text">
              {won ? (
                <>
                  You got it in <strong>{guesses.length}</strong> guess
                  {guesses.length > 1 ? "es" : ""}! The answer was{" "}
                  <span className="legend-answer">{answer.name}</span>.
                </>
              ) : (
                <>
                  Out of guesses! The answer was{" "}
                  <span className="legend-answer">{answer.name}</span>.
                </>
              )}
            </div>
            {mode === "unlimited" ? (
              <button className="play-again-btn" onClick={resetUnlimited}>
                Play Again
              </button>
            ) : (
              <div className="next-daily">
                Next Daily in <strong>{countdown}</strong>
                <button
                  className="play-again-btn secondary"
                  onClick={() => requestMode("unlimited")}
                >
                  Play Unlimited
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div id="input-area">
        {showAutocomplete && (
          <ul id="autocomplete-list">
            {filteredLegends.map((legend, index) => {
              const query = guessInput.trim();
              const lowerName = legend.name.toLowerCase();
              const lowerQuery = query.toLowerCase();
              const start = lowerName.indexOf(lowerQuery);
              const before = start >= 0 ? legend.name.slice(0, start) : legend.name;
              const match =
                start >= 0 ? legend.name.slice(start, start + lowerQuery.length) : "";
              const after =
                start >= 0 ? legend.name.slice(start + lowerQuery.length) : "";
              return (
                <li
                  key={legend.name}
                  className={index === activeIndex ? "active" : ""}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    submitGuessByName(legend.name);
                  }}
                >
                  {start >= 0 ? (
                    <>
                      {before}
                      <span className="match">{match}</span>
                      {after}
                    </>
                  ) : (
                    legend.name
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="input-wrapper">
          <input
            type="text"
            id="guess-input"
            className={shakeInput ? "shake" : ""}
            placeholder="Type a legend name..."
            value={guessInput}
            onChange={(event) => setGuessInput(event.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={gameOver}
            autoComplete="off"
            spellCheck={false}
          />
          <button id="guess-btn" onClick={() => submitGuessByName(guessInput)} disabled={gameOver}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
