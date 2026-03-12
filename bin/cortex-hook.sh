#!/bin/bash
# Cortex RAG hook for Claude Code
# Receives user prompt via stdin JSON, queries Cortex for relevant context,
# returns it as additionalContext so Claude sees it alongside the prompt.
set -e

# Read JSON input from stdin
INPUT=$(cat)

PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Skip empty or very short prompts (not worth a RAG search)
if [ -z "$PROMPT" ] || [ ${#PROMPT} -lt 10 ]; then
  exit 0
fi

# Resolve API port and auth
API_PORT="${SPACES_PORT:-3457}"
SECRET="${SPACES_SESSION_SECRET:-}"
INTERNAL_TOKEN="${SECRET:0:16}"

# URL-encode the prompt (basic: replace spaces and common chars)
ENCODED_PROMPT=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$PROMPT" 2>/dev/null \
  || node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PROMPT" 2>/dev/null \
  || echo "$PROMPT" | sed 's/ /%20/g')

# Query Cortex search API
RESPONSE=$(curl -s -m 5 \
  -H "x-spaces-internal: ${INTERNAL_TOKEN}" \
  "http://localhost:${API_PORT}/api/cortex/search/?q=${ENCODED_PROMPT}&limit=5" 2>/dev/null || echo '{}')

# Check if we got results
RESULT_COUNT=$(echo "$RESPONSE" | jq -r '.results | length // 0' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" = "0" ] || [ "$RESULT_COUNT" = "null" ]; then
  exit 0
fi

# Format the results into readable context
CONTEXT=$(echo "$RESPONSE" | jq -r '
  .results[:5] | to_entries | map(
    .value |
    "[" + (.type // "context") + "] " +
    (if .source_timestamp then (.source_timestamp | split("T")[0]) + ": " else "" end) +
    .text
  ) | join("\n\n")
' 2>/dev/null || echo "")

if [ -z "$CONTEXT" ]; then
  exit 0
fi

# Return as additionalContext
jq -n --arg context "$CONTEXT" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": ("<cortex-context>\nRelevant knowledge from your workspace history:\n\n" + $context + "\n</cortex-context>")
  }
}'

exit 0
