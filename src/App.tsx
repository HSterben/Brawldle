import { useEffect, useMemo, useState } from "react";
import legendsData from "../data/legends.json";

type Legend = {
  name: string;
  gender: string;
  weapon1: string;
  weapon2: string;
  year: number;
  stats: [number, number, number, number];
};

type Hint = "green" | "yellow" | "grey";

const MAX_GUESSES = 8;
const STAT_LABELS = ["STR", "DEX", "DEF", "SPD"];

const legends = legendsData as Legend[];

function getRandomLegend() {
  return legends[Math.floor(Math.random() * legends.length)];
}

function App() {
  const [answer, setAnswer] = useState<Legend>(() => getRandomLegend());
  const [guessInput, setGuessInput] = useState("");
  const [guesses, setGuesses] = useState<Legend[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [shakeInput, setShakeInput] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);

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
    setGuesses(nextGuesses);
    setGuessInput("");
    setShowAutocomplete(false);

    const hasWon = legend.name === answer.name;
    const outOfGuesses = nextGuesses.length >= MAX_GUESSES;

    if (hasWon || outOfGuesses) {
      setGameOver(true);
      setWon(hasWon);
    }
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

  const resetGame = () => {
    setAnswer(getRandomLegend());
    setGuessInput("");
    setGuesses([]);
    setActiveIndex(0);
    setShowAutocomplete(false);
    setShakeInput(false);
    setGameOver(false);
    setWon(false);
  };

  return (
    <div id="app">
      <header>
        <h1>BRAWLDLE</h1>
        <p className="subtitle">Guess the Brawlhalla Legend!</p>
      </header>

      <div id="game-area">
        <div className="guess-row header-row">
          <div className="cell cell-name">Legend</div>
          <div className="cell">Gender</div>
          <div className="cell">Weapon 1</div>
          <div className="cell">Weapon 2</div>
          <div className="cell">Year</div>
          <div className="cell cell-stats">Stats</div>
        </div>

        <div id="guesses">
          {guesses.map((guess) => {
            const isCorrect = guess.name === answer.name;
            return (
              <div key={guess.name} className={`guess-row ${isCorrect ? "correct" : ""}`}>
                <div className={`cell cell-name hint-${compareText(guess.name, answer.name)}`}>
                  {guess.name}
                </div>
                <div className={`cell hint-${compareText(guess.gender, answer.gender)}`}>
                  {guess.gender}
                </div>
                <div
                  className={`cell hint-${compareWeapon(
                    guess.weapon1,
                    answer.weapon1,
                    answer.weapon2,
                  )}`}
                >
                  <span className="weapon-icon">{guess.weapon1}</span>
                </div>
                <div
                  className={`cell hint-${compareWeapon(
                    guess.weapon2,
                    answer.weapon2,
                    answer.weapon1,
                  )}`}
                >
                  <span className="weapon-icon">{guess.weapon2}</span>
                </div>
                <div className={`cell hint-${compareYear(guess.year, answer.year)} year-cell`}>
                  <span>{guess.year}</span>
                  {guess.year !== answer.year && (
                    <span className="year-arrow">{guess.year < answer.year ? "▲" : "▼"}</span>
                  )}
                </div>
                <div className="cell stats-shell">
                  <div className="stats-group">
                    {guess.stats.map((value, index) => {
                      const target = answer.stats[index];
                      const hint = compareStat(value, target);
                      return (
                        <div className={`stat-cell hint-${hint}`} key={`${guess.name}-${index}`}>
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
          <button className="play-again-btn" onClick={resetGame}>
            Play Again
          </button>
        </div>
      )}

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
