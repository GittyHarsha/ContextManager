#!/usr/bin/env node
'use strict';
/**
 * ContextManager Claude Code Hook Capture Script
 *
 * Receives hook events via stdin JSON from Claude Code, normalizes them
 * to ~/.contextmanager/hook-queue.jsonl for the VS Code extension to process.
 *
 * Usage: node capture.js <HookType>
 * HookType: Stop | PostToolUse | UserPromptSubmit | PreCompact | SessionStart | SessionEnd
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const hookType = process.argv[2] || 'Unknown';
const ORIGIN = 'claude-code-plugin';
const PARTICIPANT = 'claude-code';

const CM_DIR = path.join(os.homedir(), '.contextmanager');
const QUEUE_FILE = path.join(CM_DIR, 'hook-queue.jsonl');
const SESSION_CTX = path.join(CM_DIR, 'session-context.txt');

fs.mkdirSync(CM_DIR, { recursive: true });

// ── Read stdin ────────────────────────────────────────────────────────────────
const chunks = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
	const raw = chunks.join('').trim();
	if (!raw) { out('{}'); return; }

	let data;
	try { data = JSON.parse(raw); } catch { out('{}'); return; }

	const sessionId = data.session_id || data.sessionId || '';
	const cwd = data.cwd || process.cwd();
	const ts = Date.now();

	try {
		switch (hookType) {
			case 'SessionStart':  handleSessionStart(data, sessionId, cwd, ts); break;
			case 'SessionEnd':    handleSessionEnd(data, sessionId, cwd, ts); break;
			case 'UserPromptSubmit': handleUserPromptSubmit(data, sessionId, cwd, ts); break;
			case 'PostToolUse':   handlePostToolUse(data, sessionId, cwd, ts); break;
			case 'PreCompact':    handlePreCompact(data, sessionId, cwd, ts); break;
			case 'Stop':          handleStop(data, sessionId, cwd, ts); break;
			default:              out('{}');
		}
	} catch {
		out('{}');
	}
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function out(val) {
	process.stdout.write(typeof val === 'string' ? val : JSON.stringify(val));
	process.stdout.write('\n');
}

function appendQueue(entry) {
	fs.appendFileSync(QUEUE_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function readSessionContext() {
	try {
		if (fs.existsSync(SESSION_CTX)) {
			return fs.readFileSync(SESSION_CTX, 'utf8').trim();
		}
	} catch {}
	return '';
}

function truncate(s, max) {
	if (typeof s !== 'string') return '';
	return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

// ── Transcript Parsing ───────────────────────────────────────────────────────
// Handles both Claude Code format (type='user'/'assistant' + message.content)
// and VS Code Copilot format (type='user.message'/'assistant.message' + data.content)

function extractContent(entry) {
	const content = (entry.message && entry.message.content) || (entry.data && entry.data.content);
	if (typeof content === 'string') return content.trim();
	if (Array.isArray(content)) {
		return content
			.filter(c => c.type === 'text')
			.map(c => c.text)
			.join(' ')
			.trim();
	}
	return '';
}

function getLastExchange(transcriptPath) {
	if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
	try {
		const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
		let lastUser = null;
		let lastAssistant = null;
		let lastToolCalls = [];
		let curToolCalls = [];

		for (const line of lines) {
			if (!line.trim()) continue;
			let entry;
			try { entry = JSON.parse(line); } catch { continue; }
			const role = entry.type;

			if (role === 'user' || role === 'user.message') {
				const text = extractContent(entry);
				if (text) {
					lastUser = text;
					curToolCalls = [];
				}
			} else if (role === 'assistant' || role === 'assistant.message') {
				let text = extractContent(entry);
				if (!text && entry.data && entry.data.reasoningText) {
					text = entry.data.reasoningText.trim();
				}
				if (text) {
					lastAssistant = text;
					lastToolCalls = curToolCalls.slice();
				}
			} else if (role === 'tool.execution_start' && curToolCalls.length < 10) {
				const args = entry.data && entry.data.arguments;
				curToolCalls.push({
					toolName: (entry.data && entry.data.toolName) || '',
					input: truncate(JSON.stringify(args), 2000),
					output: ''
				});
			}
		}
		return { user: lastUser, assistant: lastAssistant, toolCalls: lastToolCalls };
	} catch { return null; }
}

function getAllTurnsSinceOffset(transcriptPath, sid) {
	if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
	const offsetFile = path.join(CM_DIR, 'transcript-offset-' + sid);
	let startLine = 0;
	try {
		if (fs.existsSync(offsetFile)) {
			startLine = parseInt(fs.readFileSync(offsetFile, 'utf8').trim(), 10) || 0;
		}
	} catch {}

	try {
		const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
		if (startLine >= lines.length) return null;

		const turns = [];
		let curUser = null, curAssistant = null;

		for (let i = startLine; i < lines.length; i++) {
			if (!lines[i].trim()) continue;
			let entry;
			try { entry = JSON.parse(lines[i]); } catch { continue; }
			const role = entry.type;

			if (role === 'user' || role === 'user.message') {
				if (curUser && curAssistant) turns.push({ user: curUser, assistant: curAssistant });
				curUser = extractContent(entry);
				curAssistant = null;
			} else if (role === 'assistant' || role === 'assistant.message') {
				const text = extractContent(entry);
				if (text) curAssistant = text;
			}
		}
		if (curUser && curAssistant) turns.push({ user: curUser, assistant: curAssistant });

		fs.writeFileSync(offsetFile, String(lines.length), 'utf8');
		return turns.length > 0 ? turns : null;
	} catch { return null; }
}

// ── Event Handlers ───────────────────────────────────────────────────────────

function handleSessionStart(data, sessionId, cwd, ts) {
	appendQueue({
		hookType: 'SessionStart',
		sessionId,
		timestamp: ts,
		cwd,
		rootHint: cwd,
		origin: ORIGIN,
		participant: PARTICIPANT,
		prompt: data.initialPrompt || data.prompt || ''
	});
	const ctx = readSessionContext();
	out(ctx ? { additionalContext: ctx } : '{}');
}

function handleSessionEnd(data, sessionId, cwd, ts) {
	appendQueue({
		hookType: 'SessionEnd',
		sessionId,
		timestamp: ts,
		cwd,
		rootHint: cwd,
		origin: ORIGIN,
		participant: PARTICIPANT,
		reason: data.reason || 'complete'
	});
	out('{}');
}

function handleUserPromptSubmit(data, sessionId, cwd, ts) {
	const ctx = readSessionContext();
	out(ctx ? { additionalContext: ctx } : '{}');
}

function handlePostToolUse(data, sessionId, cwd, ts) {
	const toolName = data.tool_name || data.toolName || '';
	if (!toolName) { out('{}'); return; }

	const inputStr = truncate(
		JSON.stringify(data.tool_input || data.toolInput || data.toolArgs || {}),
		400
	);
	let resultStr = '';
	const result = data.tool_response || data.toolResponse || data.toolResult;
	if (typeof result === 'string') {
		resultStr = truncate(result, 600);
	} else if (result && result.textResultForLlm) {
		resultStr = truncate(result.textResultForLlm, 600);
	} else if (result) {
		resultStr = truncate(JSON.stringify(result), 400);
	}

	appendQueue({
		hookType: 'PostToolUse',
		toolName,
		toolInput: inputStr,
		toolResponse: resultStr,
		sessionId,
		timestamp: ts,
		cwd,
		rootHint: cwd,
		origin: ORIGIN,
		participant: PARTICIPANT
	});
	out('{}');
}

function handlePreCompact(data, sessionId, cwd, ts) {
	const transcriptPath = data.transcript_path || data.transcriptPath;

	if (transcriptPath) {
		const turns = getAllTurnsSinceOffset(transcriptPath, sessionId);
		if (turns && turns.length > 0) {
			appendQueue({
				hookType: 'PreCompact',
				sessionId,
				timestamp: ts,
				turns,
				cwd,
				rootHint: cwd,
				origin: ORIGIN
			});
		} else {
			const exchange = getLastExchange(transcriptPath);
			if (exchange && (exchange.user || exchange.assistant)) {
				appendQueue({
					hookType: 'PreCompact',
					prompt: exchange.user || '',
					response: exchange.assistant || '',
					sessionId,
					timestamp: ts,
					cwd,
					rootHint: cwd,
					origin: ORIGIN
				});
			}
		}
	}

	// Output knowledge index so Claude carries it forward after compaction
	const indexFile = path.join(CM_DIR, 'knowledge-index.txt');
	try {
		if (fs.existsSync(indexFile)) {
			const index = fs.readFileSync(indexFile, 'utf8').trim();
			if (index) { out({ systemMessage: index }); return; }
		}
	} catch {}
	out('{}');
}

function handleStop(data, sessionId, cwd, ts) {
	const transcriptPath = data.transcript_path || data.transcriptPath;
	if (!transcriptPath) { out('{}'); return; }

	const exchange = getLastExchange(transcriptPath);
	if (exchange && (exchange.user || exchange.assistant)) {
		appendQueue({
			hookType: 'Stop',
			prompt: exchange.user || '',
			response: exchange.assistant || '',
			participant: PARTICIPANT,
			sessionId,
			timestamp: ts,
			toolCalls: exchange.toolCalls || [],
			cwd,
			rootHint: cwd,
			origin: ORIGIN
		});
	}

	// Clean up offset file for this session
	const offsetFile = path.join(CM_DIR, 'transcript-offset-' + sessionId);
	try { if (fs.existsSync(offsetFile)) fs.unlinkSync(offsetFile); } catch {}

	out('{}');
}
