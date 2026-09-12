import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import legendsData from "../../data/legends.json";
import { STAT_LABELS, COLUMN_LABELS, DIFFICULTY_COLUMNS, DUEL_GUESS_SECONDS, GUESS_TIMER_OPTIONS } from "../game/types";
import type {
  ColumnId,
  Difficulty,
  DuelRule,
  Legend,
  PrivateGuessRow,
  PublicGuessRow,
} from "../game/types";
import type { ClientMessage, DuelLobbyPublic, DuelPlayerPublic, ServerMessage } from "./protocol";
import { MAX_LOBBY_PLAYERS, formatLobbyCode, normalizeLobbyCode } from "./protocol";

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
  const [left, setLeft] = useState<number>(DUEL_GUESS_SECONDS);
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

function playerStatusLabel(
  player: DuelPlayerPublic,
  lobby: DuelLobbyPublic,
  phase: DuelLobbyPublic["phase"],
) {
  const parts: string[] = [];
  if (player.id === lobby.hostId) parts.push("Host");
  if (player.id === lobby.yourId) parts.push("You");

  if (phase === "waiting") {
    parts.push(player.ready ? "Ready" : "Spectate");
  } else if (player.spectating) {
    parts.push("Spectating");
  } else if (phase === "picking") {
    parts.push(player.picked ? "Ready" : "Picking");
  } else if (phase === "playing") {
    parts.push(player.finished ? (player.solved ? "Solved" : "Done") : "Playing");
  } else if (phase === "finished") {
    parts.push(player.solved ? `Solved · ${player.guessCount}` : "Missed");
  }

  return parts.join(" · ");
}

function PlayersDrawer({
  lobby,
  open,
  onToggle,
  onKick,
}: {
  lobby: DuelLobbyPublic;
  open: boolean;
  onToggle: () => void;
  onKick: (playerId: string) => void;
}) {
  const readyCount = lobby.players.filter((player) => player.ready).length;

  return (
    <>
      <button
        type="button"
        className={`duel-players-tab ${open ? "is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="duel-players-drawer"
      >
        <span className="duel-players-tab-label">Players</span>
        <span className="duel-players-tab-count">{lobby.players.length}</span>
      </button>

      <aside
        id="duel-players-drawer"
        className={`duel-players-drawer ${open ? "is-open" : ""}`}
        aria-label="Lobby players"
        aria-hidden={!open}
      >
        <div className="duel-players-drawer-head">
          <div>
            <p className="duel-members-title">Lobby</p>
            <p className="duel-players-meta">
              {lobby.players.length}/{MAX_LOBBY_PLAYERS}
              {lobby.phase === "waiting" ? ` · ${readyCount} ready` : ""}
            </p>
          </div>
          <button type="button" className="control-btn" onClick={onToggle}>
            Close
          </button>
        </div>

        <ul className="duel-member-list">
          {lobby.players.map((player) => {
            const isYou = player.id === lobby.yourId;
            const canKick =
              lobby.youAreHost &&
              !isYou &&
              (lobby.phase === "waiting" || lobby.phase === "picking");

            return (
              <li
                key={player.id}
                className={`duel-member ${
                  player.ready && lobby.phase === "waiting" ? "is-ready" : ""
                } ${player.spectating && lobby.phase !== "waiting" ? "is-spectating" : ""}`}
              >
                <div className="duel-member-info">
                  <span className="duel-member-name">{player.name}</span>
                  <span className="duel-member-role">
                    {playerStatusLabel(player, lobby, lobby.phase)}
                  </span>
                </div>
                {canKick && (
                  <button
                    type="button"
                    className="duel-kick-btn"
                    onClick={() => onKick(player.id)}
                  >
                    Kick
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>
    </>
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
  const [playersOpen, setPlayersOpen] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const autoJoinDone = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = normalizeLobbyCode(params.get("duel") || "");
    if (fromLink) setJoinCode(fromLink);

    let opened = false;
    let cancelled = false;
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      opened = true;
      setStatus("connected");
      setError(null);
      if (fromLink.length === 6 && !autoJoinDone.current) {
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
        setError("Could not connect to battle server. Is it running?");
        return;
      }
      setStatus("error");
      setError("Disconnected from battle server.");
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
  const activeOthers =
    lobby?.players.filter(
      (player) => player.id !== lobby.yourId && !player.spectating,
    ) || [];
  const readyCount = lobby?.players.filter((player) => player.ready).length || 0;
  const youSpectating = Boolean(you?.spectating);

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

  const winnerName =
    lobby?.winnerId != null
      ? lobby.players.find((player) => player.id === lobby.winnerId)?.name
      : null;

  return (
    <div className={`duel-root ${lobby ? "has-lobby" : ""}`}>
      <div className="duel-topbar">
        <button type="button" className="control-btn" onClick={onExit}>
          ← Modes
        </button>
        <div className="duel-topbar-title">
          <span className="mode-banner-kicker">Versus</span>
          <strong>Battle</strong>
        </div>
        {lobby && (
          <button type="button" className="control-btn" onClick={leaveLobby}>
            Leave
          </button>
        )}
      </div>

      {error && <div className="duel-error">{error}</div>}
      {status === "connecting" && <p className="duel-status">Connecting to battle server…</p>}
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
                onChange={(event) => setJoinCode(normalizeLobbyCode(event.target.value))}
                placeholder="123456"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                aria-label="Lobby code"
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

      {lobby && (
        <PlayersDrawer
          lobby={lobby}
          open={playersOpen}
          onToggle={() => setPlayersOpen((prev) => !prev)}
          onKick={(playerId) => send(wsRef.current, { type: "kick", playerId })}
        />
      )}

      {lobby && lobby.phase === "waiting" && (
        <div className="duel-shell">
          <div className="duel-lobby-main">
            <div className="mode-banner">
              <div className="mode-banner-text">
                <p className="mode-banner-kicker">Lobby</p>
                <h2 className="mode-banner-title">{formatLobbyCode(lobby.code)}</h2>
                <p className="mode-banner-copy">
                  {lobby.players.length > 1
                    ? `${lobby.players.length} players in lobby · ${readyCount} ready`
                    : "Share the code or link to invite players."}
                </p>
              </div>
              <button type="button" className="play-again-btn" onClick={copyInvite}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>

            <div className="duel-invite-box">
              <code>{inviteUrl}</code>
            </div>

            {you && (
              <div className="duel-ready-controls">
                <p className="duel-ready-hint">
                  Ready to play, or stay unready to spectate when the match starts.
                </p>
                <button
                  type="button"
                  className={`play-again-btn ${you.ready ? "" : "secondary"}`}
                  onClick={() =>
                    send(wsRef.current, { type: "setReady", ready: !you.ready })
                  }
                >
                  {you.ready ? "Unready (spectate)" : "Ready up"}
                </button>
              </div>
            )}

            {lobby.youAreHost ? (
              <div className="duel-host-settings">
                <p className="difficulty-label">Match rule</p>
                <div className="control-group">
                  {(
                    [
                      ["shared", "Same random"],
                      ["pick", "Pick for others"],
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
                    ? "Every ready player hunts the same secret legend."
                    : "Each ready player secretly picks a legend; picks are shuffled so nobody gets their own."}
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

                <p className="difficulty-label">Time per guess</p>
                <div className="control-group">
                  {GUESS_TIMER_OPTIONS.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      className={`control-btn ${lobby.guessSeconds === seconds ? "active" : ""}`}
                      onClick={() =>
                        send(wsRef.current, { type: "setGuessSeconds", seconds })
                      }
                    >
                      {seconds}s
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="play-again-btn"
                  disabled={readyCount < 2}
                  onClick={() => send(wsRef.current, { type: "start" })}
                >
                  Start battle
                </button>
                {readyCount < 2 && (
                  <p className="duel-status">Need at least 2 ready players to start.</p>
                )}
              </div>
            ) : (
              <p className="duel-status">Host is setting the match rules…</p>
            )}
          </div>
        </div>
      )}

      {lobby && lobby.phase === "picking" && (
        <div className="duel-shell">
          <div className="duel-picking-main">
            <div className="mode-banner">
              <div className="mode-banner-text">
                <p className="mode-banner-kicker">Secret pick</p>
                <h2 className="mode-banner-title">
                  {youSpectating ? "Spectating picks" : "Choose a legend"}
                </h2>
                <p className="mode-banner-copy">
                  {youSpectating
                    ? "You were unready at start, so you are spectating this round."
                    : you?.picked
                      ? "Locked in. Waiting for everyone else…"
                      : "Pick a legend for someone else. You will not receive your own pick."}
                </p>
              </div>
            </div>

            <div className="duel-ready-status">
              {lobby.players
                .filter((player) => !player.spectating)
                .map((player) => (
                  <div
                    key={player.id}
                    className={`duel-ready-row ${player.picked ? "ready" : ""}`}
                  >
                    <span className="label">
                      {player.id === lobby.yourId ? "You" : player.name}
                    </span>
                    <span className="value">{player.picked ? "Ready" : "Picking…"}</span>
                  </div>
                ))}
            </div>

            {!youSpectating && !you?.picked && (
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
        </div>
      )}

      {lobby && (lobby.phase === "playing" || lobby.phase === "finished") && (
        <>
          <div className="duel-match-meta">
            <span>
              {lobby.rule === "shared" ? "Shared legend" : "Picked legends"} · {lobby.difficulty}
              {youSpectating ? " · Spectating" : ""}
            </span>
            <span>
              Least guesses wins · {lobby.guessSeconds}s per guess
            </span>
          </div>

          {youSpectating && lobby.phase === "playing" && (
            <p className="duel-status">
              You are spectating this round. Ready up after the match to play next time.
            </p>
          )}

          <div className={`duel-boards ${youSpectating ? "spectating" : ""}`}>
            {!youSpectating && (
              <PrivateBoard
                title={you?.name || "You"}
                subtitle="Your board"
                rows={lobby.yourPrivateRows}
                columns={columns}
                timerEndsAt={you?.timerEndsAt ?? null}
                finished={Boolean(you?.finished)}
              />
            )}
            {(youSpectating
              ? lobby.players.filter((player) => !player.spectating)
              : activeOthers
            ).map((player) => (
              <BlindBoard
                key={player.id}
                title={player.name}
                subtitle={youSpectating ? "Colors only" : "Opponent (colors only)"}
                rows={player.rows}
                columns={columns}
                timerEndsAt={player.timerEndsAt}
                finished={Boolean(player.finished)}
              />
            ))}
          </div>

          {lobby.phase === "playing" && !youSpectating && !you?.finished && (
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
                    : `${winnerName || "Someone"} wins!`}
              </div>
              <p className="duel-status">
                {lobby.players
                  .filter((player) => !player.spectating)
                  .map((player) => {
                    const label = player.id === lobby.yourId ? "You" : player.name;
                    const result = player.solved
                      ? `solved in ${player.guessCount}`
                      : `missed (${player.guessCount})`;
                    return `${label} ${result}`;
                  })
                  .join(" · ")}
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
