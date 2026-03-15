#!/usr/bin/env bash
# ContextManager Plugin WriteIntent Helper — Linux/macOS
# Reads a JSON payload from stdin and appends a normalized WriteIntent entry to ~/.contextmanager/hook-queue.jsonl

set -euo pipefail

CM_DIR="$HOME/.contextmanager"
QUEUE_FILE="$CM_DIR/hook-queue.jsonl"
SESSION_ROOT="$CM_DIR/plugin-sessions"

mkdir -p "$CM_DIR"
mkdir -p "$SESSION_ROOT"
touch "$QUEUE_FILE"

STDIN=$(cat)
if [ -z "$STDIN" ]; then
	echo '{}'
	exit 0
fi

json_get() {
	python3 - "$1" <<'PYEOF' <<< "$STDIN"
import json, sys
key = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)
value = data
for part in key.split('.'):
    if isinstance(value, dict):
        value = value.get(part, "")
    else:
        value = ""
        break
if value is None:
    value = ""
if isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(",", ":")))
else:
    print(str(value))
PYEOF
}

WRITE_INTENT_JSON=$(json_get "writeIntent")
if [ -z "$WRITE_INTENT_JSON" ]; then
	echo '{}'
	exit 0
fi

PLUGIN_ORIGIN="${CM_PLUGIN_ORIGIN:-copilot-cli-plugin}"
PLUGIN_PARTICIPANT="${CM_PLUGIN_PARTICIPANT:-copilot-cli}"
CWD=$(json_get "cwd")
if [ -z "$CWD" ]; then
	CWD="$PWD"
fi
PROJECT_ID_HINT=$(json_get "projectIdHint")
SESSION_ID=$(json_get "sessionId")

safe_session_key() {
	python3 - "$1" <<'PYEOF'
import hashlib, sys
print(hashlib.sha256(sys.argv[1].encode('utf-8')).hexdigest()[:24])
PYEOF
}

session_file() {
	local key
	key=$(safe_session_key "$1")
	echo "$SESSION_ROOT/$key.json"
}

new_session_id() {
	python3 - <<'PYEOF'
import time, uuid
print(f"cm-{int(time.time() * 1000)}-{uuid.uuid4().hex[:10]}")
PYEOF
}

get_or_create_session_id() {
	local working_dir="$1"
	local file
	file=$(session_file "$working_dir")
	if [ ! -f "$file" ]; then
		local session_id
		session_id=$(new_session_id)
		python3 - "$file" "$session_id" "$working_dir" <<'PYEOF'
import json, sys, time
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({
        'sessionId': sys.argv[2],
        'cwd': sys.argv[3],
        'updatedAt': int(time.time() * 1000),
    }, f, separators=(',', ':'))
PYEOF
		echo "$session_id"
		return
	fi

	python3 - "$file" <<'PYEOF'
import json, sys, time
path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8') as f:
        state = json.load(f)
except Exception:
    state = {}
session_id = state.get('sessionId')
if not session_id:
    raise SystemExit(1)
state['updatedAt'] = int(time.time() * 1000)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(state, f, separators=(',', ':'))
print(session_id)
PYEOF
}

if [ -z "$SESSION_ID" ]; then
	SESSION_ID=$(get_or_create_session_id "$CWD" || true)
fi
if [ -z "$SESSION_ID" ]; then
	SESSION_ID=$(new_session_id)
fi

TIMESTAMP=$(python3 - <<'PYEOF'
import time
print(int(time.time() * 1000))
PYEOF
)

ENTRY=$(python3 - "$SESSION_ID" "$TIMESTAMP" "$CWD" "$PLUGIN_ORIGIN" "$PLUGIN_PARTICIPANT" "$PROJECT_ID_HINT" "$WRITE_INTENT_JSON" <<'PYEOF'
import json, sys
print(json.dumps({
    'hookType': 'WriteIntent',
    'sessionId': sys.argv[1],
    'timestamp': int(sys.argv[2]),
    'cwd': sys.argv[3],
    'rootHint': sys.argv[3],
    'origin': sys.argv[4],
    'participant': sys.argv[5],
    'projectIdHint': sys.argv[6],
    'writeIntent': json.loads(sys.argv[7]),
}, separators=(',', ':')))
PYEOF
)

printf '%s\n' "$ENTRY" >> "$QUEUE_FILE"
echo '{}'