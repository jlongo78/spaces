#!/usr/bin/env bash
# Rebuild and restart Agent Spaces.
# Run from inside a Spaces pane:  bash /c/projects/spaces/scripts/rebuild.sh
set -e

SPACES_DIR="/c/projects/spaces"
PORT="${SPACES_PORT:-3457}"

echo "=== Stopping Spaces server (port $PORT) ==="

# Kill any process on the Spaces port (works on Windows git-bash and Linux/Mac)
if command -v lsof &>/dev/null; then
  pid=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  Killing PID(s): $pid"
    kill $pid 2>/dev/null || true
    sleep 1
  fi
elif command -v netstat &>/dev/null; then
  # Windows: parse netstat for the PID listening on our port
  pids=$(netstat -ano 2>/dev/null | grep ":${PORT} " | grep LISTEN | awk '{print $5}' | sort -u)
  for pid in $pids; do
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      echo "  Killing PID: $pid"
      taskkill //F //PID "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
fi

# Also try the service stop command (no-op if not installed as service)
node "$SPACES_DIR/bin/spaces.js" service stop 2>/dev/null || true

echo ""
echo "=== Building ==="
cd "$SPACES_DIR"
npm run build 2>&1

echo ""
echo "=== Starting Spaces ==="
# Start in background, detached from this terminal
nohup node "$SPACES_DIR/bin/spaces.js" > "$SPACES_DIR/.next/server.log" 2>&1 &
SERVER_PID=$!

# Wait for it to come up
echo "  Waiting for server (PID $SERVER_PID) on port $PORT..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
    echo ""
    echo "=== Spaces is running at http://localhost:$PORT ==="
    exit 0
  fi
  sleep 1
  printf "."
done

echo ""
echo "  Server may still be starting — check http://localhost:$PORT"
echo "  Logs: $SPACES_DIR/.next/server.log"
