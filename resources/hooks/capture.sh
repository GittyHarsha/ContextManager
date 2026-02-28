#!/usr/bin/env bash
# cm-version: 2
# ContextManager Agent Hook Script — Linux/macOS
# Handles: SessionStart, PostToolUse, PreCompact, Stop
# Installed to: ~/.contextmanager/scripts/capture.sh

set -euo pipefail

CM_DIR="$HOME/.contextmanager"
QUEUE_FILE="$CM_DIR/hook-queue.jsonl"
SESSION_CTX="$CM_DIR/session-context.txt"

mkdir -p "$CM_DIR"

# Read stdin
STDIN=$(cat)
if [ -z "$STDIN" ]; then exit 0; fi

HOOK_TYPE=$(echo "$STDIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hookEventName',''))" 2>/dev/null || echo "")
SESSION_ID=$(echo "$STDIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sessionId',''))" 2>/dev/null || echo "")
TRANSCRIPT=$(echo "$STDIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || echo "")
TS=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || date +%s000)

# Helper: get last user + assistant from JSONL transcript
get_last_exchange() {
  local tpath="$1"
  if [ ! -f "$tpath" ]; then echo '{"user":"","assistant":""}'; return; fi
  python3 - "$tpath" <<'PYEOF'
import sys, json

path = sys.argv[1]
last_user = ""
last_assistant = ""

with open(path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            entry = json.loads(line)
            role = entry.get("type", "")
            content = entry.get("message", {}).get("content", "")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                text = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
            else:
                text = ""
            if role == "user":
                last_user = text
            elif role == "assistant":
                last_assistant = text
        except Exception:
            pass

print(json.dumps({"user": last_user[:1000], "assistant": last_assistant[:2000]}))
PYEOF
}

# Helper: get ALL turns since the last offset from a JSONL transcript
get_all_turns_since_offset() {
  local tpath="$1"
  local sid="$2"
  if [ ! -f "$tpath" ]; then echo ""; return; fi
  python3 - "$tpath" "$CM_DIR" "$sid" <<'PYEOF'
import sys, json, os

transcript_path = sys.argv[1]
cm_dir = sys.argv[2]
session_id = sys.argv[3]
offset_file = os.path.join(cm_dir, f"transcript-offset-{session_id}")

start_line = 0
if os.path.exists(offset_file):
    try:
        with open(offset_file, "r") as f:
            start_line = int(f.read().strip())
    except:
        start_line = 0

with open(transcript_path, "r", encoding="utf-8") as f:
    all_lines = f.readlines()

total_lines = len(all_lines)
if start_line >= total_lines:
    print("")
    sys.exit(0)

turns = []
current_user = None
current_assistant = None

for i in range(start_line, total_lines):
    line = all_lines[i].strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
        role = entry.get("type", "")
        content = entry.get("message", {}).get("content", "")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
        else:
            text = ""

        if role == "user":
            if current_user and current_assistant:
                turns.append({"user": current_user, "assistant": current_assistant})
            current_user = text
            current_assistant = None
        elif role == "assistant":
            current_assistant = text
    except:
        pass

if current_user and current_assistant:
    turns.append({"user": current_user, "assistant": current_assistant})

# Update offset
with open(offset_file, "w") as f:
    f.write(str(total_lines))

if turns:
    print(json.dumps(turns))
else:
    print("")
PYEOF
}

case "$HOOK_TYPE" in

  "SessionStart")
    if [ -f "$SESSION_CTX" ]; then
      CTX=$(cat "$SESSION_CTX")
      if [ -n "$CTX" ]; then
        python3 -c "import sys,json; print(json.dumps({'hookSpecificOutput':{'hookEventName':'SessionStart','additionalContext':sys.argv[1]}}))" "$CTX"
      fi
    fi
    exit 0
    ;;

  "PostToolUse")
    TOOL_NAME=$(echo "$STDIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")
    if [ -z "$TOOL_NAME" ]; then exit 0; fi
    ENTRY=$(echo "$STDIN" | python3 - "$TOOL_NAME" "$SESSION_ID" "$TS" <<'PYEOF'
import sys, json
raw = sys.stdin.read()
d = json.loads(raw)
tool_name = sys.argv[1]
session_id = sys.argv[2]
ts = int(sys.argv[3])
inp = json.dumps(d.get("tool_input", {}))[:300]
resp = str(d.get("tool_response", ""))[:600]
print(json.dumps({"hookType":"PostToolUse","toolName":tool_name,"toolInput":inp,"toolResponse":resp,"sessionId":session_id,"timestamp":ts}))
PYEOF
)
    echo "$ENTRY" >> "$QUEUE_FILE"
    exit 0
    ;;

  "PreCompact")
    if [ -z "$TRANSCRIPT" ]; then exit 0; fi
    TURNS_JSON=$(get_all_turns_since_offset "$TRANSCRIPT" "$SESSION_ID")
    if [ -n "$TURNS_JSON" ]; then
      # Multi-turn format
      python3 - "$SESSION_ID" "$TS" "$TURNS_JSON" <<'PYEOF'
import sys, json
session_id = sys.argv[1]
ts = int(sys.argv[2])
turns = json.loads(sys.argv[3])
entry = {"hookType":"PreCompact","sessionId":session_id,"timestamp":ts,"turns":turns}
print(json.dumps(entry))
PYEOF
      | tee -a "$QUEUE_FILE" > /dev/null
    else
      # Fallback: single exchange
      EXCHANGE=$(get_last_exchange "$TRANSCRIPT")
      python3 - "$SESSION_ID" "$TS" "$EXCHANGE" <<'PYEOF'
import sys, json
session_id = sys.argv[1]
ts = int(sys.argv[2])
exchange = json.loads(sys.argv[3])
if not exchange["user"] and not exchange["assistant"]:
    sys.exit(0)
entry = {"hookType":"PreCompact","prompt":exchange["user"],"response":exchange["assistant"],"participant":"copilot","sessionId":session_id,"timestamp":ts}
print(json.dumps(entry))
PYEOF
      | tee -a "$QUEUE_FILE" > /dev/null
    fi

    # Print knowledge index to stdout for context survival
    INDEX_FILE="$CM_DIR/knowledge-index.txt"
    if [ -f "$INDEX_FILE" ]; then
      cat "$INDEX_FILE"
    fi

    exit 0
    ;;

  "Stop")
    if [ -z "$TRANSCRIPT" ]; then exit 0; fi
    EXCHANGE=$(get_last_exchange "$TRANSCRIPT")
    ENTRY=$(python3 - "$SESSION_ID" "$TS" "$EXCHANGE" <<'PYEOF'
import sys, json
session_id = sys.argv[1]
ts = int(sys.argv[2])
exchange = json.loads(sys.argv[3])
if not exchange["user"] and not exchange["assistant"]:
    sys.exit(0)
entry = {"hookType":"Stop","prompt":exchange["user"],"response":exchange["assistant"],"participant":"copilot","sessionId":session_id,"timestamp":ts}
print(json.dumps(entry))
PYEOF
)
    if [ -n "$ENTRY" ]; then
      echo "$ENTRY" >> "$QUEUE_FILE"
    fi

    # Clean up offset file for this session
    OFFSET_FILE="$CM_DIR/transcript-offset-$SESSION_ID"
    rm -f "$OFFSET_FILE" 2>/dev/null

    exit 0
    ;;

esac

exit 0
