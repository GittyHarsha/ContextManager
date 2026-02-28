# cm-version: 4
# ContextManager Agent Hook Script — Windows PowerShell
# Handles: SessionStart, PostToolUse, PreCompact, Stop
# Installed to: ~/.contextmanager/scripts/capture.ps1
#
# VS Code calls this script for each hook event, passing JSON via stdin.
# Output JSON to stdout to influence agent behavior (SessionStart only injects context).

$ErrorActionPreference = 'SilentlyContinue'

$cmDir      = "$env:USERPROFILE\.contextmanager"
$queueFile  = "$cmDir\hook-queue.jsonl"
$sessionCtx = "$cmDir\session-context.txt"

# Ensure directory exists
$null = New-Item -ItemType Directory -Force -Path $cmDir 2>$null

# Read stdin
$stdinText = [System.Console]::In.ReadToEnd()
if (-not $stdinText) { exit 0 }

try { $data = $stdinText | ConvertFrom-Json } catch { exit 0 }

$hookType  = $data.hookEventName
$sessionId = $data.sessionId
$ts        = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

# ── Helper: extract last user + assistant turn from a JSONL transcript ──────
function Get-LastExchange($transcriptPath) {
    if (-not (Test-Path $transcriptPath)) { return $null }
    try {
        $lines = Get-Content $transcriptPath -Encoding UTF8
        $lastUser      = $null
        $lastAssistant = $null
        $lastToolCalls = @()
        $curToolCalls  = @()
        foreach ($line in $lines) {
            if (-not $line.Trim()) { continue }
            try {
                $entry = $line | ConvertFrom-Json
                $role  = $entry.type
                # Handle both Claude Code format (type='user'/'assistant' + message.content)
                # and VS Code Copilot format (type='user.message'/'assistant.message' + data.content)
                if ($role -eq 'user' -or $role -eq 'user.message') {
                    $content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
                    if ($content -is [string] -and $content.Trim()) {
                        $lastUser = $content.Trim()
                    } elseif ($content -is [array]) {
                        $texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
                        $lastUser = ($texts -join ' ').Trim()
                    }
                    $curToolCalls = @()
                } elseif ($role -eq 'assistant' -or $role -eq 'assistant.message') {
                    $content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
                    # VS Code: content may be empty string when toolRequests is set; also check reasoningText
                    if ($content -is [string] -and $content.Trim()) {
                        $lastAssistant = $content.Trim()
                        $lastToolCalls = $curToolCalls
                    } elseif ($content -is [array]) {
                        $texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
                        $t = ($texts -join ' ').Trim()
                        if ($t) { $lastAssistant = $t; $lastToolCalls = $curToolCalls }
                    }
                    # Fall back to reasoningText if content is empty (VS Code Copilot tool-call turns)
                    if ((-not $lastAssistant) -and $entry.data.reasoningText) {
                        $lastAssistant = $entry.data.reasoningText.Trim()
                        $lastToolCalls = $curToolCalls
                    }
                } elseif ($role -eq 'tool.execution_start' -and $curToolCalls.Count -lt 10) {
                    $rawArgs   = $entry.data.arguments
                    $inputJson = ($rawArgs | ConvertTo-Json -Compress -Depth 3 2>$null) -replace '(.{2000}).*','$1…'
                    $curToolCalls += @{
                        toolName = $entry.data.toolName
                        input    = if ($inputJson) { $inputJson } else { '' }
                        output   = ''
                    }
                }
            } catch {}
        }
        return @{ user = $lastUser; assistant = $lastAssistant; toolCalls = $lastToolCalls }
    } catch { return $null }
}

# ── Helper: find VS Code Copilot transcript by sessionId ────────────────────
function Find-CopilotTranscript($sid) {
    if (-not $sid) { return $null }
    $wsBase = "$env:APPDATA\Code\User\workspaceStorage"
    if (-not (Test-Path $wsBase)) { return $null }
    $found = Get-ChildItem $wsBase -Recurse -Filter "$sid.jsonl" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

# ── Helper: extract ALL turns since the last offset from a JSONL transcript ──
# Used by PreCompact to capture multi-turn context for Claude Code sessions
function Get-AllTurnsSinceOffset($transcriptPath, $sid) {
    if (-not (Test-Path $transcriptPath)) { return $null }
    $offsetFile = "$cmDir\transcript-offset-$sid"
    $startLine = 0
    if (Test-Path $offsetFile) {
        try { $startLine = [int](Get-Content $offsetFile -Raw).Trim() } catch { $startLine = 0 }
    }
    try {
        $allLines = Get-Content $transcriptPath -Encoding UTF8
        $totalLines = $allLines.Count
        if ($startLine -ge $totalLines) { return $null }

        $turns = @()
        $curUser = $null
        $curAssistant = $null

        for ($i = $startLine; $i -lt $totalLines; $i++) {
            $line = $allLines[$i]
            if (-not $line.Trim()) { continue }
            try {
                $entry = $line | ConvertFrom-Json
                $role  = $entry.type
                if ($role -eq 'user' -or $role -eq 'user.message') {
                    if ($curUser -and $curAssistant) { $turns += @{ user = $curUser; assistant = $curAssistant } }
                    $content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
                    if ($content -is [string] -and $content.Trim()) { $curUser = $content.Trim() }
                    elseif ($content -is [array]) {
                        $texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
                        $curUser = ($texts -join ' ').Trim()
                    }
                    $curAssistant = $null
                } elseif ($role -eq 'assistant' -or $role -eq 'assistant.message') {
                    $content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
                    $text = $null
                    if ($content -is [string] -and $content.Trim()) { $text = $content.Trim() }
                    elseif ($content -is [array]) {
                        $texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
                        $text = ($texts -join ' ').Trim()
                    }
                    if ($text) { $curAssistant = $text }
                }
            } catch {}
        }
        if ($curUser -and $curAssistant) { $turns += @{ user = $curUser; assistant = $curAssistant } }
        Set-Content -Path $offsetFile -Value $totalLines -Encoding UTF8
        if ($turns.Count -eq 0) { return $null }
        return $turns
    } catch { return $null }
}

# ── Helper: get the LAST completed user+assistant pair from a VS Code transcript ──
# Returns @{ userId=...; user=...; assistant=... } or $null
# "Completed" means we have both user.message AND a subsequent assistant.message with non-empty content
function Get-LastCompletedTurn($transcriptPath) {
    if (-not (Test-Path $transcriptPath)) { return $null }
    try {
        $lines        = Get-Content $transcriptPath -Encoding UTF8
        $pairs        = @()
        $curUserId    = $null
        $curUser      = $null
        $curAssistant = $null
        $curToolCalls = @()   # tool.execution_start entries between user and assistant

        foreach ($line in $lines) {
            if (-not $line.Trim()) { continue }
            try {
                $entry = $line | ConvertFrom-Json
                $role  = $entry.type

                if ($role -eq 'user' -or $role -eq 'user.message') {
                    # Flush previous complete pair before starting a new user turn
                    if ($curUser -and $curAssistant) {
                        $pairs += @{ userId = $curUserId; user = $curUser; assistant = $curAssistant; toolCalls = $curToolCalls }
                    }
                    $content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
                    $text = $null
                    if ($content -is [string] -and $content.Trim()) { $text = $content.Trim() }
                    elseif ($content -is [array]) {
                        $texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
                        $text = ($texts -join ' ').Trim()
                    }
                    $curUserId    = $entry.id
                    $curUser      = $text
                    $curAssistant = $null
                    $curToolCalls = @()
                }
                elseif ($role -eq 'assistant' -or $role -eq 'assistant.message') {
                    $content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
                    $text = $null
                    if ($content -is [string] -and $content.Trim()) { $text = $content.Trim() }
                    elseif ($content -is [array]) {
                        $texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
                        $text = ($texts -join ' ').Trim()
                    }
                    # Only record non-empty text responses (skip pure tool-dispatch turns)
                    if ($text) { $curAssistant = $text }
                }
                elseif ($role -eq 'tool.execution_start' -and $curToolCalls.Count -lt 10) {
                    # Capture tool call evidence — capped at 10 calls, input truncated to 2000 chars
                    $rawArgs   = $entry.data.arguments
                    $inputJson = ($rawArgs | ConvertTo-Json -Compress -Depth 3 2>$null) -replace '(.{2000}).*','$1…'
                    $curToolCalls += @{
                        toolName = $entry.data.toolName
                        input    = if ($inputJson) { $inputJson } else { '' }
                        output   = ''   # not available in VS Code transcript
                    }
                }
            } catch {}
        }
        # Flush the final pair if complete
        if ($curUser -and $curAssistant) {
            $pairs += @{ userId = $curUserId; user = $curUser; assistant = $curAssistant; toolCalls = $curToolCalls }
        }

        if ($pairs.Count -gt 0) { return $pairs[-1] }
        return $null
    } catch { return $null }
}

# ── Append entry to queue file ───────────────────────────────────────────────
function Append-Queue($obj) {
    try {
        $line = $obj | ConvertTo-Json -Compress -Depth 5
        Add-Content -Path $queueFile -Value $line -Encoding UTF8
    } catch {}
}

switch ($hookType) {

    "SessionStart" {
        $ctx = $null
        if (Test-Path $sessionCtx) {
            $ctx = (Get-Content $sessionCtx -Raw -Encoding UTF8).Trim()
        }
        if ($ctx) {
            @{
                hookSpecificOutput = @{
                    hookEventName   = "SessionStart"
                    additionalContext = $ctx
                }
            } | ConvertTo-Json -Compress | Write-Output
        }
        exit 0
    }

    "PostToolUse" {
        $toolName   = $data.tool_name
        $toolInput  = $data.tool_input
        $toolResult = $data.tool_response
        if (-not $toolName) { exit 0 }

        # Truncate large inputs/outputs
        $inputStr  = ($toolInput  | ConvertTo-Json -Compress 2>$null) -replace '(.{400}).*','$1…'
        $resultStr = if ($toolResult -is [string]) {
            if ($toolResult.Length -gt 600) { $toolResult.Substring(0, 600) + '…' } else { $toolResult }
        } else { ($toolResult | ConvertTo-Json -Compress 2>$null) -replace '(.{400}).*','$1…' }

        Append-Queue @{
            hookType     = "PostToolUse"
            toolName     = $toolName
            toolInput    = $inputStr
            toolResponse = $resultStr
            sessionId    = $sessionId
            timestamp    = $ts
        }

        # Also scan Copilot transcript for any completed user+assistant turns
        # (Stop hook never fires for VS Code Copilot; we harvest here with ID-based dedup)
        if ($sessionId) {
            $txPath = Find-CopilotTranscript $sessionId
            if ($txPath) {
                $turn = Get-LastCompletedTurn $txPath
                if ($turn -and $turn.userId) {
                    # Only queue if this user message hasn't been queued before
                    $seenFile = "$cmDir\seen-turn-$sessionId"
                    $lastSeen = if (Test-Path $seenFile) { (Get-Content $seenFile -Raw).Trim() } else { '' }
                    if ($turn.userId -ne $lastSeen) {
                        $p = if ($turn.user)      { $turn.user }      else { '' }
                        $r = if ($turn.assistant) { $turn.assistant } else { '' }
                        if ($p -or $r) {
                            $tc = if ($turn.toolCalls -and $turn.toolCalls.Count -gt 0) { $turn.toolCalls } else { @() }
                            Append-Queue @{
                                hookType    = "Stop"
                                prompt      = $p
                                response    = $r
                                toolCalls   = $tc
                                participant = "copilot"
                                sessionId   = $sessionId
                                timestamp   = $ts
                            }
                            Set-Content $seenFile $turn.userId -Encoding UTF8
                        }
                    }
                }
            }
        }

        exit 0
    }

    "PreCompact" {
        $transcriptPath = $data.transcript_path
        if (-not $transcriptPath) { exit 0 }

        # Get all turns since last offset
        $turns = Get-AllTurnsSinceOffset $transcriptPath $sessionId
        if ($turns -and $turns.Count -gt 0) {
            Append-Queue @{
                hookType  = "PreCompact"
                sessionId = $sessionId
                timestamp = $ts
                turns     = $turns
            }
        } else {
            # Fallback: extract last exchange only (pre-v2 behavior)
            $exchange = Get-LastExchange($transcriptPath)
            if ($exchange -and ($exchange.user -or $exchange.assistant)) {
                $prompt   = if ($exchange.user)      { $exchange.user }      else { '' }
                $response = if ($exchange.assistant) { $exchange.assistant } else { '' }
                Append-Queue @{
                    hookType  = "PreCompact"
                    prompt    = $prompt
                    response  = $response
                    sessionId = $sessionId
                    timestamp = $ts
                }
            }
        }

        # Print knowledge index to stdout so Claude carries it forward after compaction
        $indexFile = "$cmDir\knowledge-index.txt"
        if (Test-Path $indexFile) {
            $index = (Get-Content $indexFile -Raw -Encoding UTF8).Trim()
            if ($index) { Write-Output $index }
        }

        exit 0
    }

    "Stop" {
        $dbgKeys = $data.PSObject.Properties.Name -join ','
        $dbgTxp  = $data.transcript_path
        Add-Content "$cmDir\stop-debug.log" "[$ts] Stop fired keys=$dbgKeys transcript_path=$dbgTxp sessionId=$sessionId" -Encoding UTF8
        $transcriptPath = $data.transcript_path
        # Auto-discover VS Code Copilot transcript when transcript_path not provided
        if (-not $transcriptPath -and $sessionId) {
            $transcriptPath = Find-CopilotTranscript $sessionId
            Add-Content "$cmDir\stop-debug.log" "[$ts] Auto-discovered transcript: $transcriptPath" -Encoding UTF8
        }
        if (-not $transcriptPath) {
            Add-Content "$cmDir\stop-debug.log" "[$ts] No transcript found - exiting" -Encoding UTF8
            exit 0
        }

        $exchange = Get-LastExchange($transcriptPath)
        $dbgU = if ($exchange -and $exchange.user)      { $exchange.user.Substring(0, [Math]::Min(80, $exchange.user.Length)) }      else { 'null' }
        $dbgA = if ($exchange -and $exchange.assistant) { $exchange.assistant.Substring(0, [Math]::Min(80, $exchange.assistant.Length)) } else { 'null' }
        Add-Content "$cmDir\stop-debug.log" "[$ts] Exchange user=$dbgU assistant=$dbgA" -Encoding UTF8
        if ($exchange -and ($exchange.user -or $exchange.assistant)) {
            $prompt   = if ($exchange.user)      { $exchange.user }      else { '' }
            $response = if ($exchange.assistant) { $exchange.assistant } else { '' }
            $tc       = if ($exchange.toolCalls) { $exchange.toolCalls } else { @() }
            Append-Queue @{
                hookType    = "Stop"
                prompt      = $prompt
                response    = $response
                participant = "copilot"
                sessionId   = $sessionId
                timestamp   = $ts
                toolCalls   = $tc
            }
        }

        # Clean up offset file for this session
        $offsetFile = "$cmDir\transcript-offset-$sessionId"
        if (Test-Path $offsetFile) {
            Remove-Item $offsetFile -Force -ErrorAction SilentlyContinue
        }

        exit 0
    }

}

exit 0


