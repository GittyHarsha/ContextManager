#!/usr/bin/env bash
# ContextManager Copilot CLI Hook Script — Linux/macOS
# Normalizes Copilot CLI hook payloads into ~/.contextmanager/hook-queue.jsonl

set -euo pipefail

CM_DIR="$HOME/.contextmanager"
QUEUE_FILE="$CM_DIR/hook-queue.jsonl"
SESSION_ROOT="$CM_DIR/plugin-sessions"
SESSION_CTX="$CM_DIR/session-context.txt"

mkdir -p "$CM_DIR"
mkdir -p "$SESSION_ROOT"
touch "$QUEUE_FILE"

STDIN=$(cat)
if [ -z "$STDIN" ]; then
	echo '{}'
	exit 0
fi

HOOK_TYPE="${CM_HOOK_TYPE:-Unknown}"
PLUGIN_ORIGIN="${CM_PLUGIN_ORIGIN:-copilot-cli-plugin}"
PLUGIN_PARTICIPANT="${CM_PLUGIN_PARTICIPANT:-copilot-cli}"

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

PROVIDED_SESSION_ID=$(json_get "sessionId")
if [ -z "$PROVIDED_SESSION_ID" ]; then
	PROVIDED_SESSION_ID=$(json_get "session_id")
fi

CWD=$(json_get "cwd")
if [ -z "$CWD" ]; then
	CWD="$PWD"
fi

TIMESTAMP=$(json_get "timestamp")
if [ -z "$TIMESTAMP" ]; then
	TIMESTAMP=$(python3 - <<'PYEOF'
import time
print(int(time.time() * 1000))
PYEOF
)
fi

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
	local force_new="$2"
	local file
	file=$(session_file "$working_dir")
	if [ "$force_new" = "1" ] || [ ! -f "$file" ]; then
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

set_session_id() {
	local working_dir="$1"
	local session_id="$2"
	local file
	file=$(session_file "$working_dir")
	python3 - "$file" "$session_id" "$working_dir" <<'PYEOF'
import json, sys, time
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({
        'sessionId': sys.argv[2],
        'cwd': sys.argv[3],
        'updatedAt': int(time.time() * 1000),
    }, f, separators=(',', ':'))
PYEOF
}

remove_session_id() {
	local working_dir="$1"
	rm -f "$(session_file "$working_dir")"
}

append_queue() {
	printf '%s\n' "$1" >> "$QUEUE_FILE"
}

SOURCE=$(json_get "source")
FORCE_NEW=0
if [ "$HOOK_TYPE" = "SessionStart" ] && { [ "$SOURCE" = "new" ] || [ "$SOURCE" = "startup" ] || [ ! -f "$(session_file "$CWD")" ]; }; then
	FORCE_NEW=1
fi
SESSION_ID=$(get_or_create_session_id "$CWD" "$FORCE_NEW" || true)
if [ -n "$PROVIDED_SESSION_ID" ]; then
	set_session_id "$CWD" "$PROVIDED_SESSION_ID"
	SESSION_ID="$PROVIDED_SESSION_ID"
elif [ -z "$SESSION_ID" ]; then
	SESSION_ID=$(new_session_id)
fi

case "$HOOK_TYPE" in
	"SessionStart")
		INITIAL_PROMPT=$(json_get "initialPrompt")
		ENTRY=$(python3 - "$SESSION_ID" "$TIMESTAMP" "$CWD" "$PLUGIN_ORIGIN" "$PLUGIN_PARTICIPANT" "$INITIAL_PROMPT" <<'PYEOF'
import json, sys
print(json.dumps({
    'hookType': 'SessionStart',
    'sessionId': sys.argv[1],
    'timestamp': int(sys.argv[2]),
    'cwd': sys.argv[3],
    'rootHint': sys.argv[3],
    'origin': sys.argv[4],
    'participant': sys.argv[5],
    'prompt': sys.argv[6],
}, separators=(',', ':')))
PYEOF
)
		append_queue "$ENTRY"
		if [ -f "$SESSION_CTX" ]; then
			python3 - "$SESSION_CTX" <<'PYEOF'
import json, pathlib, sys
print(json.dumps({'additionalContext': pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')}, separators=(',', ':')))
PYEOF
		else
			echo '{}'
		fi
		;;

	"UserPromptSubmitted")
		PROMPT=$(json_get "prompt")
		if [ -f "$SESSION_CTX" ]; then
			python3 - "$SESSION_CTX" <<'PYEOF'
import json, pathlib, sys
print(json.dumps({'additionalContext': pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')}, separators=(',', ':')))
PYEOF
		else
			echo '{}'
		fi
		;;

	"PostToolUse")
		TOOL_NAME=$(json_get "toolName")
		TOOL_ARGS=$(json_get "toolArgs")
		TOOL_RESULT_TYPE=$(json_get "toolResult.resultType")
		TOOL_RESULT_TEXT=$(json_get "toolResult.textResultForLlm")
		ENTRY=$(python3 - "$SESSION_ID" "$TIMESTAMP" "$CWD" "$PLUGIN_ORIGIN" "$PLUGIN_PARTICIPANT" "$TOOL_NAME" "$TOOL_ARGS" "$TOOL_RESULT_TEXT" "$TOOL_RESULT_TYPE" <<'PYEOF'
import json, sys
print(json.dumps({
    'hookType': 'PostToolUse',
    'sessionId': sys.argv[1],
    'timestamp': int(sys.argv[2]),
    'cwd': sys.argv[3],
    'rootHint': sys.argv[3],
    'origin': sys.argv[4],
    'participant': sys.argv[5],
    'toolName': sys.argv[6],
    'toolInput': sys.argv[7],
    'toolResponse': sys.argv[8],
    'toolResultType': sys.argv[9],
}, separators=(',', ':')))
PYEOF
)
		append_queue "$ENTRY"
		echo '{}'
		;;

	"ErrorOccurred")
		ERROR_MESSAGE=$(json_get "error.message")
		ERROR_NAME=$(json_get "error.name")
		ERROR_STACK=$(json_get "error.stack")
		ENTRY=$(python3 - "$SESSION_ID" "$TIMESTAMP" "$CWD" "$PLUGIN_ORIGIN" "$PLUGIN_PARTICIPANT" "$ERROR_MESSAGE" "$ERROR_NAME" "$ERROR_STACK" <<'PYEOF'
import json, sys
print(json.dumps({
    'hookType': 'ErrorOccurred',
    'sessionId': sys.argv[1],
    'timestamp': int(sys.argv[2]),
    'cwd': sys.argv[3],
    'rootHint': sys.argv[3],
    'origin': sys.argv[4],
    'participant': sys.argv[5],
    'error': {
        'message': sys.argv[6],
        'name': sys.argv[7],
        'stack': sys.argv[8],
    },
}, separators=(',', ':')))
PYEOF
)
		append_queue "$ENTRY"
		echo '{}'
		;;

	"SessionEnd")
		REASON=$(json_get "reason")
		if [ -z "$REASON" ]; then
			REASON="complete"
		fi
		ENTRY=$(python3 - "$SESSION_ID" "$TIMESTAMP" "$CWD" "$PLUGIN_ORIGIN" "$PLUGIN_PARTICIPANT" "$REASON" <<'PYEOF'
import json, sys
print(json.dumps({
    'hookType': 'SessionEnd',
    'sessionId': sys.argv[1],
    'timestamp': int(sys.argv[2]),
    'cwd': sys.argv[3],
    'rootHint': sys.argv[3],
    'origin': sys.argv[4],
    'participant': sys.argv[5],
    'reason': sys.argv[6],
}, separators=(',', ':')))
PYEOF
)
		append_queue "$ENTRY"
		remove_session_id "$CWD"
		echo '{}'
		;;

	*)
		echo '{}'
		;;
esac