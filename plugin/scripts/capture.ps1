# ContextManager Copilot CLI Hook Script — Windows PowerShell
# Normalizes Copilot CLI hook payloads into ~/.contextmanager/hook-queue.jsonl

$ErrorActionPreference = 'Stop'

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cmDir = Join-Path $env:USERPROFILE '.contextmanager'
$queueFile = Join-Path $cmDir 'hook-queue.jsonl'
$sessionRoot = Join-Path $cmDir 'plugin-sessions'
$sessionCtx = Join-Path $cmDir 'session-context.txt'

$null = New-Item -ItemType Directory -Force -Path $cmDir
$null = New-Item -ItemType Directory -Force -Path $sessionRoot
if (-not (Test-Path $queueFile)) {
	Set-Content -Path $queueFile -Value '' -Encoding UTF8
}

$stdinText = [Console]::In.ReadToEnd()
if (-not $stdinText) {
	'{}'
	exit 0
}

try {
	$data = $stdinText | ConvertFrom-Json
} catch {
	'{}'
	exit 0
}

$hookType = if ($env:CM_HOOK_TYPE) { $env:CM_HOOK_TYPE } else { 'Unknown' }
$origin = if ($env:CM_PLUGIN_ORIGIN) { $env:CM_PLUGIN_ORIGIN } else { 'copilot-cli-plugin' }
$participant = if ($env:CM_PLUGIN_PARTICIPANT) { $env:CM_PLUGIN_PARTICIPANT } else { 'copilot-cli' }
$cwd = if ($data.cwd) { [string]$data.cwd } else { (Get-Location).Path }
$timestamp = if ($data.timestamp) { [long]$data.timestamp } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$providedSessionId = if ($data.sessionId) {
	[string]$data.sessionId
} elseif ($data.session_id) {
	[string]$data.session_id
} else {
	''
}

function Get-SafeSessionKey([string]$value) {
	if (-not $value) { $value = 'default' }
	$hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').ToLowerInvariant()
	return $hash.Substring(0, 24)
}

function Get-SessionFile([string]$workingDir) {
	$key = Get-SafeSessionKey $workingDir
	return Join-Path $sessionRoot ($key + '.json')
}

function New-SessionId {
	return ('cm-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
}

function Get-OrCreateSessionId([string]$workingDir, [switch]$ForceNew) {
	$sessionFile = Get-SessionFile $workingDir
	if ($ForceNew -or -not (Test-Path $sessionFile)) {
		$sessionId = New-SessionId
		@{
			sessionId = $sessionId
			cwd = $workingDir
			updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
		} | ConvertTo-Json -Compress | Set-Content -Path $sessionFile -Encoding UTF8
		return $sessionId
	}

	try {
		$state = Get-Content $sessionFile -Raw | ConvertFrom-Json
		if ($state.sessionId) {
			$state.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
			$state | ConvertTo-Json -Compress | Set-Content -Path $sessionFile -Encoding UTF8
			return [string]$state.sessionId
		}
	} catch {}

	return Get-OrCreateSessionId $workingDir -ForceNew
}

function Set-SessionId([string]$workingDir, [string]$sessionId) {
	if (-not $sessionId) { return }
	$sessionFile = Get-SessionFile $workingDir
	@{
		sessionId = $sessionId
		cwd = $workingDir
		updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
	} | ConvertTo-Json -Compress | Set-Content -Path $sessionFile -Encoding UTF8
}

function Remove-SessionId([string]$workingDir) {
	$sessionFile = Get-SessionFile $workingDir
	if (Test-Path $sessionFile) {
		Remove-Item $sessionFile -Force -ErrorAction SilentlyContinue
	}
}

function Append-Queue([hashtable]$entry) {
	($entry | ConvertTo-Json -Compress -Depth 20) | Add-Content -Path $queueFile -Encoding UTF8
}

$forceNew = $hookType -eq 'SessionStart' -and (($data.source -eq 'new') -or ($data.source -eq 'startup') -or -not (Test-Path (Get-SessionFile $cwd)))
$sessionId = if ($providedSessionId) {
	Set-SessionId $cwd $providedSessionId
	$providedSessionId
} else {
	Get-OrCreateSessionId $cwd -ForceNew:$forceNew
}

switch ($hookType) {
	'SessionStart' {
		Append-Queue @{
			hookType = 'SessionStart'
			sessionId = $sessionId
			timestamp = $timestamp
			cwd = $cwd
			rootHint = $cwd
			origin = $origin
			participant = $participant
			prompt = if ($data.initialPrompt) { [string]$data.initialPrompt } else { '' }
		}

		if (Test-Path $sessionCtx) {
			$ctx = Get-Content $sessionCtx -Raw
			(@{ additionalContext = $ctx } | ConvertTo-Json -Compress)
		} else {
			'{}'
		}
		exit 0
	}

	'UserPromptSubmitted' {
		if (Test-Path $sessionCtx) {
			$ctx = Get-Content $sessionCtx -Raw
			(@{ additionalContext = $ctx } | ConvertTo-Json -Compress)
		} else {
			'{}'
		}
		exit 0
	}

	'PostToolUse' {
		$toolArgs = if ($data.toolArgs) { [string]$data.toolArgs } else { '{}' }
		$toolResultText = if ($data.toolResult.textResultForLlm) { [string]$data.toolResult.textResultForLlm } else { '' }
		Append-Queue @{
			hookType = 'PostToolUse'
			sessionId = $sessionId
			timestamp = $timestamp
			cwd = $cwd
			rootHint = $cwd
			origin = $origin
			participant = $participant
			toolName = if ($data.toolName) { [string]$data.toolName } else { '' }
			toolInput = $toolArgs
			toolResponse = $toolResultText
			toolResultType = if ($data.toolResult.resultType) { [string]$data.toolResult.resultType } else { '' }
		}
		'{}'
		exit 0
	}

	'ErrorOccurred' {
		Append-Queue @{
			hookType = 'ErrorOccurred'
			sessionId = $sessionId
			timestamp = $timestamp
			cwd = $cwd
			rootHint = $cwd
			origin = $origin
			participant = $participant
			error = @{
				message = if ($data.error.message) { [string]$data.error.message } else { '' }
				name = if ($data.error.name) { [string]$data.error.name } else { '' }
				stack = if ($data.error.stack) { [string]$data.error.stack } else { '' }
			}
		}
		'{}'
		exit 0
	}

	'SessionEnd' {
		Append-Queue @{
			hookType = 'SessionEnd'
			sessionId = $sessionId
			timestamp = $timestamp
			cwd = $cwd
			rootHint = $cwd
			origin = $origin
			participant = $participant
			reason = if ($data.reason) { [string]$data.reason } else { 'complete' }
		}
		Remove-SessionId $cwd
		'{}'
		exit 0
	}

	{ $_ -eq 'AgentStop' -or $_ -eq 'SubagentStop' } {
		# agentStop / subagentStop — agent finished responding. 
		# Extract prompt + response from input if available.
		$prompt = ''
		$response = ''
		if ($data.prompt) { $prompt = [string]$data.prompt }
		if ($data.response) { $response = [string]$data.response }
		# Some implementations pass transcript_path instead
		if (-not $prompt -and -not $response -and $data.transcript_path) {
			# Attempt to read last exchange from transcript if path provided
			$tPath = [string]$data.transcript_path
			if (Test-Path $tPath) {
				try {
					$lines = Get-Content $tPath -Encoding UTF8
					$lastUser = $null
					$lastAssistant = $null
					foreach ($line in $lines) {
						if (-not $line.Trim()) { continue }
						try {
							$entry = $line | ConvertFrom-Json
							$role = $entry.type
							if ($role -eq 'user' -or $role -eq 'user.message') {
								$content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
								if ($content -is [string] -and $content.Trim()) { $lastUser = $content.Trim() }
								elseif ($content -is [array]) {
									$texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
									$lastUser = ($texts -join ' ').Trim()
								}
							} elseif ($role -eq 'assistant' -or $role -eq 'assistant.message') {
								$content = if ($entry.message) { $entry.message.content } else { $entry.data.content }
								$text = $null
								if ($content -is [string] -and $content.Trim()) { $text = $content.Trim() }
								elseif ($content -is [array]) {
									$texts = $content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }
									$text = ($texts -join ' ').Trim()
								}
								if ($text) { $lastAssistant = $text }
							}
						} catch {}
					}
					if ($lastUser)      { $prompt   = $lastUser }
					if ($lastAssistant) { $response = $lastAssistant }
				} catch {}
			}
		}
		if ($prompt -or $response) {
			Append-Queue @{
				hookType  = 'Stop'
				prompt    = $prompt
				response  = $response
				participant = $participant
				sessionId = $sessionId
				timestamp = $timestamp
				toolCalls = @()
				cwd       = $cwd
				rootHint  = $cwd
				origin    = $origin
			}
		}
		'{}'
		exit 0
	}

	'PreToolUse' {
		# PreToolUse — log but don't block
		'{}'
		exit 0
	}

	default {
		'{}'
		exit 0
	}
}