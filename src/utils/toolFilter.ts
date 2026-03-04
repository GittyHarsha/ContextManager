/**
 * Centralized tool filtering and name normalization.
 *
 * Instead of hardcoding third-party tool names (e.g. "haystack", "findtext"),
 * we classify tools by inspecting their description/inputSchema for capability
 * keywords. Our own tools (`contextmanager_*`) are always included.
 *
 * This keeps the extension agnostic — any search/read/terminal tool from any
 * provider gets picked up automatically without code changes.
 */

import * as vscode from 'vscode';

// ─── Capability keywords (matched against tool name + description) ──

/** Keywords that indicate a tool performs search / code-navigation. */
const SEARCH_KEYWORDS = [
	'search', 'find', 'grep', 'locate', 'lookup', 'query',
	'code usage', 'references', 'definition', 'symbol',
];

/** Keywords that indicate a tool reads files or lists directories. */
const READ_KEYWORDS = [
	'read file', 'read_file', 'readfile',
	'list dir', 'list_dir', 'listdir', 'directory',
	'get file', 'file content', 'open file',
];

/** Keywords that indicate a tool runs commands in a terminal. */
const TERMINAL_KEYWORDS = [
	'terminal', 'run command', 'run_in_terminal', 'execute command', 'shell',
];

/** Keywords that indicate a tool creates or edits files. */
const EDIT_KEYWORDS = [
	'create file', 'create_file', 'write file', 'edit file',
	'replace', 'insert', 'modify file',
];

// ─── Composite sets for quick classification ────────────────────

const WORKSPACE_KEYWORDS = [
	...SEARCH_KEYWORDS,
	...READ_KEYWORDS,
	...TERMINAL_KEYWORDS,
	...EDIT_KEYWORDS,
];

// ─── Public API ─────────────────────────────────────────────────

export interface ToolFilterOptions {
	/** Tool names to explicitly exclude (lowercase). */
	exclude?: string[];
	/** If true, include file-editing tools. Default: true. */
	includeEditTools?: boolean;
	/** If true, include terminal tools. Default: true. */
	includeTerminalTools?: boolean;
}

/**
 * Returns tools suitable for agent use: all ContextManager tools plus
 * any workspace tool (search, read, terminal, edit) from any provider.
 *
 * This replaces the old hardcoded allowlist approach.
 */
export function getWorkspaceTools(options?: ToolFilterOptions): vscode.LanguageModelToolInformation[] {
	const exclude = new Set(options?.exclude?.map(n => n.toLowerCase()) ?? []);
	const includeEdit = options?.includeEditTools ?? true;
	const includeTerminal = options?.includeTerminalTools ?? true;

	return vscode.lm.tools.filter(tool => {
		const name = tool.name.toLowerCase();

		if (exclude.has(name)) { return false; }

		// Always include our own tools
		if (name.startsWith('contextmanager_')) { return true; }

		// Check name + description against capability keywords
		const haystack = `${name} ${(tool.description || '').toLowerCase()}`;

		if (matchesAny(haystack, SEARCH_KEYWORDS)) { return true; }
		if (matchesAny(haystack, READ_KEYWORDS)) { return true; }
		if (includeTerminal && matchesAny(haystack, TERMINAL_KEYWORDS)) { return true; }
		if (includeEdit && matchesAny(haystack, EDIT_KEYWORDS)) { return true; }

		return false;
	});
}

/**
 * Same as `getWorkspaceTools` but returns the shape expected by
 * `LanguageModelChatRequestOptions.tools`.
 */
export function getWorkspaceChatTools(options?: ToolFilterOptions): vscode.LanguageModelChatTool[] {
	return getWorkspaceTools(options).map(tool => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema as Record<string, unknown>,
	}));
}

// ─── Tool Classification (for autoLearn) ────────────────────────

/**
 * Returns true if the given tool name looks like a search / code-navigation tool.
 */
export function isSearchTool(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	const desc = _descriptionCache.get(lower) ?? '';
	const haystack = `${lower} ${desc}`;
	return matchesAny(haystack, SEARCH_KEYWORDS);
}

/**
 * Returns true if the given tool name looks like a file-read / directory-list tool.
 */
export function isReadTool(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	const desc = _descriptionCache.get(lower) ?? '';
	const haystack = `${lower} ${desc}`;
	return matchesAny(haystack, READ_KEYWORDS);
}

/**
 * Returns true if the given tool name looks like a workspace-relevant tool.
 * (Any of: search, read, terminal, edit, or contextmanager_*)
 */
export function isWorkspaceTool(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	if (lower.startsWith('contextmanager_')) { return true; }
	const desc = _descriptionCache.get(lower) ?? '';
	const haystack = `${lower} ${desc}`;
	return matchesAny(haystack, WORKSPACE_KEYWORDS);
}

// ─── Display Name Normalization ─────────────────────────────────

/**
 * Simplifies a tool name for display purposes.
 * Strips known prefixes, normalizes separators.
 * Provider-agnostic — no hardcoded third-party names.
 */
export function simplifyToolName(name: string): string {
	return name
		.replace(/^contextManager_/i, '')
		.replace(/_/g, ':');
}

/**
 * Simplifies a tool name for progress messages (space-separated, no prefix).
 */
export function toolDisplayLabel(name: string): string {
	return name
		.replace(/^contextManager_/i, '')
		.replace(/_/g, ' ');
}

// ─── Description Cache ──────────────────────────────────────────

/**
 * Lazily-built cache of tool name → lowercase description.
 * Populated on first classification call.
 */
const _descriptionCache = new Map<string, string>();

/**
 * Call once (e.g. at activation or first use) to prime the description cache.
 * Safe to call multiple times — it rebuilds from current `vscode.lm.tools`.
 */
export function refreshToolDescriptionCache(): void {
	_descriptionCache.clear();
	for (const tool of vscode.lm.tools) {
		_descriptionCache.set(tool.name.toLowerCase(), (tool.description || '').toLowerCase());
	}
}

// ─── Internal ───────────────────────────────────────────────────

function matchesAny(text: string, keywords: string[]): boolean {
	return keywords.some(kw => text.includes(kw));
}
