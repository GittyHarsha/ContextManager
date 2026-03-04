/**
 * Shared helpers used across all chat command handlers.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../cache';
import { ProjectManager } from '../projects/ProjectManager';
import { ExplainerMetadata, ToolCallRound } from '../prompts/index';

// ─── Helpers ────────────────────────────────────────────────────

export async function getCopilotInstructions(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) { return undefined; }
	for (const folder of workspaceFolders) {
		const uri = vscode.Uri.joinPath(folder.uri, '.github/copilot-instructions.md');
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			return doc.getText();
		} catch { /* not found */ }
	}
	return undefined;
}

export function getWorkspacePaths(projectManager: ProjectManager): string[] {
	const activeProject = projectManager.getActiveProject();
	if (activeProject?.rootPaths?.length) {
		return activeProject.rootPaths;
	}
	const folders = vscode.workspace.workspaceFolders;
	return folders?.map(f => f.uri.fsPath) ?? [];
}

export async function getProjectContext(
	projectManager: ProjectManager,
	cache: ExplanationCache
): Promise<string> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject || !projectManager.isContextEnabled(activeProject.id)) {
		return '';
	}
	return await projectManager.getFullProjectContext(activeProject.id, cache) || '';
}

/**
 * Get branch context for prompt injection.
 * Branch sessions have been removed; returns empty string for backward compatibility.
 */
export async function getBranchContext(_projectManager: ProjectManager): Promise<string> {
	return '';
}

/**
 * Auto-save branch session after agent runs complete.
 * Branch sessions have been removed; this is a no-op stub for backward compatibility.
 */
export async function autoSaveBranchSession(
	_projectManager: ProjectManager,
	_requestPrompt: string,
	_chatContext?: vscode.ChatContext,
): Promise<void> {
	// Branch sessions removed — no-op
}

/**
 * Returns a focused set of tools for chat and analysis commands.
 * Includes search/read tools + our custom ContextManager tools,
 * but excludes unrelated extension tools that would bloat the token budget.
 * /todo uses vscode.lm.tools (ALL tools) for full autonomous capability.
 */
export function getAgentTools(): vscode.LanguageModelToolInformation[] {
	return vscode.lm.tools.filter(tool => {
		const name = tool.name.toLowerCase();
		return (
			// Search tools
			name.includes('haystack') ||
			name.includes('grep') || name.includes('findtext') ||
			name.includes('semantic_search') ||
			name.includes('file_search') ||
			// Read tools
			name.includes('read') ||
			// Directory tools
			name.includes('listdir') || name.includes('list_dir') ||
			// Our own tools
			name.startsWith('contextmanager_') ||
			// Code navigation
			name.includes('list_code_usages') || name.includes('codeusages') ||
			// Terminal (for running tests, checking build)
			name.includes('terminal') || name.includes('run_in_terminal')
		);
	});
}

/**
 * Deselect all selected context (knowledge cards and cache entries) after use,
 * if the auto-deselect setting is enabled.
 */
export async function deselectContextAfterUse(
	projectManager: ProjectManager,
	cache: ExplanationCache
): Promise<void> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		return;
	}

	// Deselect all knowledge cards
	const selectedCards = projectManager.getSelectedCardIds(activeProject.id);
	if (selectedCards.length > 0) {
		await projectManager.deselectAllCards(activeProject.id);
	}

	// Deselect all cache entries
	const selectedCacheIds = cache.getSelectedEntryIds(activeProject.id);
	if (selectedCacheIds.length > 0) {
		cache.deselectAllEntries(activeProject.id);
	}
}

// ─── Result helpers ─────────────────────────────────────────────

export interface ToolLoopResult {
	fullResponse: string;
	/** Only the final model response (after all tool calls are done) — no thinking tokens */
	lastResponse: string;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	/** True if the loop hit the tool call limit */
	maxToolCallsExceeded?: boolean;
}

export function makeResult(command: string, loopResult: ToolLoopResult): ExplainerMetadata {
	return {
		command,
		cached: false,
		toolCallsMetadata: {
			toolCallRounds: loopResult.toolCallRounds,
			toolCallResults: loopResult.toolCallResults,
		},
	};
}

export function noToolsResult(command: string, cached = false): ExplainerMetadata {
	return {
		command,
		cached,
		toolCallsMetadata: {
			toolCallRounds: [],
			toolCallResults: {},
		},
	};
}
