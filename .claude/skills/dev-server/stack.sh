#!/usr/bin/env bash
# The local stack for one task: the authoritative server and the Vite
# client, in the background, with their logs and pids in one run directory,
# and a state directory of their own so a task never touches data/.
#
#   .claude/skills/dev-server/stack.sh up        # build + start both, wait until ready
#   .claude/skills/dev-server/stack.sh status    # what is running, on which ports, where the logs are
#   .claude/skills/dev-server/stack.sh log [n]   # last n lines of the server log (default 40)
#   .claude/skills/dev-server/stack.sh links     # confirmation and reset links the log-only mailer printed
#   .claude/skills/dev-server/stack.sh down      # stop both
#
# Knobs (env): PORT (server, default from .env then 8787), CLIENT_PORT (Vite,
# default 5173), DATA_DIR (default RUN_DIR/data; set DATA_DIR=data for the
# ordinary local state), RUN_DIR (default .dev, gitignored), NO_CLIENT=1 to
# start only the server, and anything the server reads from .env
# (ANTHROPIC_API_KEY, GENERATION_PROVIDER=mock, ...) is passed through.
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root" || exit 1
# shellcheck disable=SC1091
. "$root/.claude/skills/dev-server/node_env.sh" || exit 1

RUN_DIR="${RUN_DIR:-$root/.dev}"
mkdir -p "$RUN_DIR"
if [ -z "${PORT:-}" ] && [ -f .env ]; then
  PORT="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
fi
PORT="${PORT:-8787}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
DATA_DIR="${DATA_DIR:-$RUN_DIR/data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$root/$DATA_DIR" ;; esac
export PORT DATA_DIR

server_pid="$RUN_DIR/server.pid"
client_pid="$RUN_DIR/client.pid"
server_log="$RUN_DIR/server.log"
client_log="$RUN_DIR/client.log"

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
listening() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1$2"; }

wait_for() { # port path label
  for _ in $(seq 1 60); do
    listening "$1" "$2" && return 0
    sleep 0.5
  done
  echo "timeout: $3 did not answer on :$1" >&2
  return 1
}

up() {
  if alive "$server_pid"; then
    echo "server already running (pid $(cat "$server_pid")), see status"
  elif listening "$PORT" /api/session; then
    echo "something else already listens on :$PORT (another checkout's pnpm server?). Set PORT to a free one." >&2
    exit 1
  else
    node scripts/build_server.mjs >"$server_log" 2>&1 || { cat "$server_log"; exit 1; }
    mkdir -p "$DATA_DIR"
    # --env-file-if-exists mirrors pnpm server: .env knobs apply, the shell wins.
    nohup node --env-file-if-exists=.env dist-server/server.cjs >>"$server_log" 2>&1 &
    echo $! >"$server_pid"
    wait_for "$PORT" /api/session server || { tail -20 "$server_log"; exit 1; }
    echo "server on :$PORT, state in $DATA_DIR, log $server_log"
    grep -E '^(suggestions|mail|generation|discord|arena):' "$server_log" | sed 's/^/  /'
  fi
  if [ "${NO_CLIENT:-}" = "1" ]; then return; fi
  if alive "$client_pid"; then
    echo "client already running (pid $(cat "$client_pid"))"
  elif listening "$CLIENT_PORT" /; then
    echo "something else already listens on :$CLIENT_PORT. Set CLIENT_PORT to a free one." >&2
    exit 1
  else
    nohup pnpm exec vite --port "$CLIENT_PORT" --strictPort >"$client_log" 2>&1 &
    echo $! >"$client_pid"
    wait_for "$CLIENT_PORT" / client || { tail -20 "$client_log"; exit 1; }
    echo "client on http://localhost:$CLIENT_PORT (proxies /api and /ws to :$PORT), log $client_log"
  fi
}

down() {
  for f in "$client_pid" "$server_pid"; do
    if alive "$f"; then
      pid="$(cat "$f")"
      # The client is a pnpm wrapper around vite: take the process group.
      kill -- -"$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill "$pid" 2>/dev/null
      echo "stopped pid $pid ($(basename "$f" .pid))"
    fi
    rm -f "$f"
  done
}

status() {
  for name in server client; do
    f="$RUN_DIR/$name.pid"
    if alive "$f"; then echo "$name: running (pid $(cat "$f"))"; else echo "$name: not running"; fi
  done
  echo "server port :$PORT ($(listening "$PORT" /api/session && echo answering || echo silent))"
  echo "client port :$CLIENT_PORT ($(listening "$CLIENT_PORT" / && echo answering || echo silent))"
  echo "state: $DATA_DIR"
  echo "logs: $server_log, $client_log"
}

links() {
  # The log-only mailer prints each mail after a [mail:log-only] line; the
  # links in it are the confirmation and reset URLs a developer follows.
  grep -Eo 'https?://[^ ]+' "$server_log" 2>/dev/null | grep -E '/(confirm|reset)' || echo "no links printed yet"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  log) tail -n "${2:-40}" "$server_log" ;;
  links) links ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
