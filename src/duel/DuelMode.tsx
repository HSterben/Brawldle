import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import legendsData from "../../data/legends.json";
import { STAT_LABELS, COLUMN_LABELS, DIFFICULTY_COLUMNS, DUEL_GUESS_SECONDS } from "../game/types";
import type {
  ColumnId,
  Difficulty,
  DuelRule,
  Legend,
  PrivateGuessRow,
  PublicGuessRow,
} from "../game/types";
import type { ClientMessage, DuelLobbyPublic, ServerMessage } from "./protocol";

const legends = legendsData as Legend[];

function wsUrl() {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV) return `${protocol}//localhost:3001`;
  return `${protocol}//${window.location.host}/ws`;
}

function send(ws: WebSocket | null, message: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function useSecondsLeft(endsAt: number | null) {
  const [left, setLeft] = useState(DUEL_GUESS_SECONDS);
  useEffect(() => {
    if (!endsAt) {
      setLeft(DUEL_GUESS_SECONDS);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return left;
}

function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (name: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return [];
    return legends
      .filter((legend) => legend.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [value]);

  return createPortal(
    <div className="duel-input-block">
      {filtered.length > 0 && value.trim() && !disabled && (
        <ul className="duel-autocomplete">
          {filtered.map((legend, index) => (
            <li
              key={legend.name}
              className={index === activeIndex ? "active" : ""}
              onMouseDown={(event) => {
                event.preventDefault();
                onSubmit(legend.name);
              }}
            >
              {legend.name}
            </li>
          ))}
        </ul>
      )}
      <div className="input-wrapper duel-inline-input">
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder || "Type a legend name..."}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((prev) => Math.max(prev - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const pick = filtered[activeIndex]?.name || value;
              onSubmit(pick);
            }
          }}
        />
        <button
          type="button"
          id="guess-btn"
          disabled={disabled}
          onClick={() => onSubmit(filtered[activeIndex]?.name || value)}
        >
          Go
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PrivateBoard({
  rows,
  columns,
  title,
  subtitle,
  timerEndsAt,
  finished,
}: {
  rows: PrivateGuessRow[];
  columns: ColumnId[];
  title: string;
  subtitle: string;
  timerEndsAt: number | null;
  finished: boolean;
}) {
  const seconds = useSecondsLeft(finished ? null : timerEndsAt);
  return (
    <div className="duel-board you">
      <div className="duel-board-head">
        <div>
          <p className="duel-board-kicker">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        {!finished && timerEndsAt && (
          <div className={`duel-timer ${seconds <= 5 ? "urgent" : ""}`}>{seconds}s</div>
        )}
      </div>
      <div className={`guess-row header-row cols-${columns.length}`}>
        {columns.map((column) => (
          <div key={column} className={`cell ${column === "name" ? "cell-name" : ""}`}>
            {COLUMN_LABELS[column]}
          </div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div
          key={`${row.legendName || "timeout"}-${rowIndex}`}
          className={`guess-row cols-${columns.length} ${row.solved ? "correct" : ""}`}
        >
          {row.cells.map((cell, cellIndex) => {
            if (cell.column === "stats") {
              return (
                <div key={cellIndex} className="cell stats-shell">
                  <div className="stats-group">
                    {cell.hints.map((hint, index) => (
                      <div className={`stat-cell hint-${hint}`} key={index}>
                        <span className="stat-label">{STAT_LABELS[index]}</span>
                        <span>{row.timedOut ? "—" : row.stats?.[index]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            const text =
              row.timedOut
                ? "TIME"
                : cell.column === "name"
                  ? row.legendName
                  : cell.column === "gender"
                    ? row.gender
                    : cell.column === "weapon1"
                      ? row.weapon1
                      : cell.column === "weapon2"
                        ? row.weapon2
                        : cell.column === "year"
                          ? row.year
                          : "";

            return (
              <div
                key={cellIndex}
                className={`cell ${cell.column === "name" ? "cell-name" : ""} hint-${cell.hint} ${
                  cell.column === "year" ? "year-cell" : ""
                }`}
              >
                <span>{text}</span>
                {cell.column === "year" && cell.yearArrow && !row.timedOut && (
                  <span className="year-arrow">{cell.yearArrow === "up" ? "▲" : "▼"}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function BlindBoard({
  rows,
  columns,
  title,
  subtitle,
  timerEndsAt,
  finished,
}: {
  rows: PublicGuessRow[];
  columns: ColumnId[];
  title: string;
  subtitle: string;
  timerEndsAt: number | null;
  finished: boolean;
}) {
  const seconds = useSecondsLeft(finished ? null : timerEndsAt);
  return (
    <div className="duel-board foe">
      <div className="duel-board-head">
        <div>
          <p className="duel-board-kicker">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        {!finished && timerEndsAt && (
          <div className={`duel-timer ghost ${seconds <= 5 ? "urgent" : ""}`}>{seconds}s</div>
        )}
      </div>
      <div className={`guess-row header-row cols-${columns.length}`}>
        {columns.map((column) => (
          <div key={column} className={`cell ${column === "name" ? "cell-name" : ""}`}>
            {COLUMN_LABELS[column]}
          </div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`guess-row cols-${columns.length} ${row.solved ? "correct" : ""}`}
        >
          {row.cells.map((cell, cellIndex) => {
            if (cell.column === "stats") {
              return (
                <div key={cellIndex} className="cell stats-shell">
                  <div className="stats-group">
                    {cell.hints.map((hint, index) => (
                      <div className={`stat-cell hint-${hint}`} key={index}>
                        <span className="stat-label">{STAT_LABELS[index]}</span>
                        <span className="blind-mark" />
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div
                key={cellIndex}
                className={`cell hint-${cell.hint} ${cell.column === "name" ? "cell-name" : ""}`}
              >
                <span className="blind-mark" />
              </div>
            );
          })}
        </div>
      ))}
      {rows.length === 0 && <p className="duel-empty">Waiting for their guesses…</p>}
    </div>
  );
}

type DuelModeProps = {
  onExit: () => void;
};

export default function DuelMode({ onExit }: DuelModeProps) {
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<DuelLobbyPublic | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pickInput, setPickInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [copied, setCopied] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const autoJoinDone = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("duel");
    if (fromLink) setJoinCode(fromLink.toUpperCase());

    let opened = false;
    let cancelled = false;
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      opened = true;
      setStatus("connected");
      setError(null);
      if (fromLink && !autoJoinDone.current) {
        autoJoinDone.current = true;
        send(ws, { type: "join", code: fromLink, name: displayName || undefined });
      }
    };
    ws.onmessage = (event) => {
      if (cancelled) return;
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "lobby") setLobby(message.lobby);
      if (message.type === "error") setError(message.message);
      if (message.type === "gone") {
        setError(message.message);
        setLobby(null);
      }
    };
    ws.onerror = () => {
      // Real failure is handled in onclose; avoid noisy mid-lifecycle errors.
    };
    ws.onclose = () => {
      if (cancelled) return;
      if (!opened) {
        setStatus("error");
        setError("Could not connect to duel server. Is it running?");
        return;
      }
      setStatus("error");
      setError("Disconnected from duel server.");
      setLobby(null);
    };

    return () => {
      cancelled = true;
      send(ws, { type: "leave" });
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const columns = DIFFICULTY_COLUMNS[lobby?.difficulty || "easy"];
  const you = lobby?.players.find((player) => player.id === lobby.yourId);
  const foe = lobby?.players.find((player) => player.id !== lobby.yourId);

  const inviteUrl = lobby
    ? `${window.location.origin}${window.location.pathname}?duel=${lobby.code}`
    : "";

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const leaveLobby = () => {
    send(wsRef.current, { type: "leave" });
    setLobby(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("duel");
    window.history.replaceState({}, "", url.pathname);
  };

  return (
    <div className="duel-root">
      <div className="duel-topbar">
        <button type="button" className="control-btn" onClick={onExit}>
          ← Modes
        </button>
        <div className="duel-topbar-title">
          <span className="mode-banner-kicker">Versus</span>
          <strong>1v1 Duel</strong>
        </div>
        {lobby && (
          <button type="button" className="control-btn" onClick={leaveLobby}>
            Leave
          </button>
        )}
      </div>

      {error && <div className="duel-error">{error}</div>}
      {status === "connecting" && <p className="duel-status">Connecting to duel server…</p>}
      {status === "error" && !lobby && (
        <p className="duel-status">
          Start the server with <code>npm run duel</code> (or <code>npm run dev:all</code>).
        </p>
      )}

      {!lobby && status === "connected" && (
        <div className="duel-setup">
          <label className="duel-field">
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional"
              maxLength={16}
            />
          </label>

          <div className="duel-setup-actions">
            <button
              type="button"
              className="play-again-btn"
              onClick={() => {
                setError(null);
                send(wsRef.current, { type: "create", name: displayName || undefined });
              }}
            >
              Host lobby
            </button>
            <div className="duel-join-row">
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="CODE"
                maxLength={6}
              />
              <button
                type="button"
                className="play-again-btn secondary"
                onClick={() => {
                  setError(null);
                  send(wsRef.current, {
                    type: "join",
                    code: joinCode,
                    name: displayName || undefined,
                  });
                }}
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}

      {lobby && lobby.phase === "waiting" && (
        <div className="duel-lobby">
          <div className="mode-banner">
            <div className="mode-banner-text">
              <p className="mode-banner-kicker">Lobby</p>
              <h2 className="mode-banner-title">{lobby.code}</h2>
              <p className="mode-banner-copy">
                {foe ? `${you?.name} vs ${foe.name}` : "Waiting for your opponent to join…"}
              </p>
            </div>
            <button type="button" className="play-again-btn" onClick={copyInvite}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <div className="duel-invite-box">
            <code>{inviteUrl}</code>
          </div>

          {lobby.youAreHost ? (
            <div className="duel-host-settings">
              <p className="difficulty-label">Match rule</p>
              <div className="control-group">
                {(
                  [
                    ["shared", "Same random"],
                    ["pick", "Pick for each other"],
                  ] as [DuelRule, string][]
                ).map(([rule, label]) => (
                  <button
                    key={rule}
                    type="button"
                    className={`control-btn ${lobby.rule === rule ? "active" : ""}`}
                    onClick={() => send(wsRef.current, { type: "setRule", rule })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="duel-rule-help">
                {lobby.rule === "shared"
                  ? "Both players hunt the same secret legend."
                  : "Each player secretly picks the legend the opponent must guess."}
              </p>

              <p className="difficulty-label">Difficulty</p>
              <div className="control-group">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`control-btn ${lobby.difficulty === level ? "active" : ""}`}
                    onClick={() =>
                      send(wsRef.current, { type: "setDifficulty", difficulty: level })
                    }
                  >
                    {level}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="play-again-btn"
                disabled={!foe}
                onClick={() => send(wsRef.current, { type: "start" })}
              >
                Start duel
              </button>
            </div>
          ) : (
            <p className="duel-status">Host is setting the match rules…</p>
          )}
        </div>
      )}

      {lobby && lobby.phase === "picking" && (
        <div className="duel-picking">
          <div className="mode-banner">
            <div className="mode-banner-text">
              <p className="mode-banner-kicker">Secret pick</p>
              <h2 className="mode-banner-title">Choose their legend</h2>
              <p className="mode-banner-copy">
                {you?.picked
                  ? "Locked in. Waiting for opponent…"
                  : "Pick the legend your opponent has to guess."}
              </p>
            </div>
          </div>
          {!you?.picked && (
            <AutocompleteInput
              value={pickInput}
              onChange={setPickInput}
              onSubmit={(name) => {
                send(wsRef.current, { type: "pick", legendName: name });
                setPickInput("");
              }}
            />
          )}
        </div>
      )}

      {lobby && (lobby.phase === "playing" || lobby.phase === "finished") && (
        <>
          <div className="duel-match-meta">
            <span>
              {lobby.rule === "shared" ? "Shared legend" : "Picked legends"} · {lobby.difficulty}
            </span>
            <span>
              Least guesses wins · {DUEL_GUESS_SECONDS}s per guess
            </span>
          </div>

          <div className="duel-boards">
            <PrivateBoard
              title={you?.name || "You"}
              subtitle="Your board"
              rows={lobby.yourPrivateRows}
              columns={columns}
              timerEndsAt={you?.timerEndsAt ?? null}
              finished={Boolean(you?.finished)}
            />
            <BlindBoard
              title={foe?.name || "Opponent"}
              subtitle="Opponent (colors only)"
              rows={foe?.rows || []}
              columns={columns}
              timerEndsAt={foe?.timerEndsAt ?? null}
              finished={Boolean(foe?.finished)}
            />
          </div>

          {lobby.phase === "playing" && !you?.finished && (
            <AutocompleteInput
              value={guessInput}
              onChange={setGuessInput}
              disabled={you?.finished}
              onSubmit={(name) => {
                send(wsRef.current, { type: "guess", legendName: name });
                setGuessInput("");
              }}
            />
          )}

          {lobby.phase === "finished" && (
            <div id="result-banner" className="duel-result">
              <div id="result-text">
                {lobby.draw
                  ? "Draw!"
                  : lobby.winnerId === lobby.yourId
                    ? "You win!"
                    : `${foe?.name || "Opponent"} wins!`}
              </div>
              <p className="duel-status">
                You {you?.solved ? `solved in ${you.guessCount}` : `missed (${you?.guessCount || 0})`}{" "}
                · Opponent{" "}
                {foe?.solved ? `solved in ${foe.guessCount}` : `missed (${foe?.guessCount || 0})`}
                {lobby.yourAnswer ? (
                  <>
                    <br />
                    Your legend was <span className="legend-answer">{lobby.yourAnswer.name}</span>
                  </>
                ) : null}
              </p>
              {lobby.youAreHost ? (
                <button
                  type="button"
                  className="play-again-btn"
                  onClick={() => send(wsRef.current, { type: "rematch" })}
                >
                  Rematch
                </button>
              ) : (
                <p className="duel-status">Waiting for host rematch…</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
