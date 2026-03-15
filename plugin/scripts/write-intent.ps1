# ContextManager Plugin WriteIntent Helper — Windows PowerShell
# Reads a JSON payload from stdin and appends a normalized WriteIntent entry to ~/.contextmanager/hook-queue.jsonl

$ErrorActionPreference = 'Stop'

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cmDir = Join-Path $env:USERPROFILE '.contextmanager'
$queueFile = Join-Path $cmDir 'hook-queue.jsonl'
$sessionRoot = Join-Path $cmDir 'plugin-sessions'

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
	$data = $stdinText | ConvertFrom-Json -Depth 50
} catch {
	'{}'
	exit 0
}

if (-not $data.writeIntent) {
	'{}'
	exit 0
}

$origin = if ($env:CM_PLUGIN_ORIGIN) { $env:CM_PLUGIN_ORIGIN } else { 'copilot-cli-plugin' }
$participant = if ($env:CM_PLUGIN_PARTICIPANT) { $env:CM_PLUGIN_PARTICIPANT } else { 'copilot-cli' }
$cwd = if ($data.cwd) { [string]$data.cwd } else { (Get-Location).Path }
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

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

function Get-OrCreateSessionId([string]$workingDir) {
	$sessionFile = Get-SessionFile $workingDir
	if (-not (Test-Path $sessionFile)) {
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

	return New-SessionId
}

$sessionId = if ($data.sessionId) { [string]$data.sessionId } else { Get-OrCreateSessionId $cwd }

$entry = @{
	hookType = 'WriteIntent'
	sessionId = $sessionId
	timestamp = $timestamp
	cwd = $cwd
	rootHint = $cwd
	origin = $origin
	participant = $participant
	projectIdHint = if ($data.projectIdHint) { [string]$data.projectIdHint } else { '' }
	writeIntent = $data.writeIntent
}

($entry | ConvertTo-Json -Compress -Depth 50) | Add-Content -Path $queueFile -Encoding UTF8
'{}'