/**
 * Tools barrel — re-exports all tool classes and the registerTools() function.
 *
 * Also owns the module-level _toolStream registry so file tools can emit
 * stream.textEdit() calls for the VS Code diff UI.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../cache';
import { ConfigurationManager } from '../config';
import { EmbeddingManager } from '../embeddings';
import { ProjectManager } from '../projects/ProjectManager';
import { SearchIndex } from '../search/SearchIndex';

// Tool classes
import { ProjectContextTool } from './projectContextTool';
import { TodoManagerTool } from './todoManagerTool';
import { SubagentTool } from './subagentTool';
import {
	WriteFileTool,
	ReplaceStringInFileTool,
	FileStatTool,
	RenameFileTool,
	DeleteFileTool,
	CopyFileTool,
	CreateDirectoryTool,
} from './fileTools';
import { SaveKnowledgeCardTool, EditKnowledgeCardTool, OrganizeKnowledgeCardsTool, GetCardTool } from './knowledgeCardTools';
import { SaveCacheTool, SearchCacheTool, ReadCacheTool, EditCacheTool } from './cacheTools';
import { SemanticSearchTool, CtxTool } from './searchTools';
import type { AutoCaptureService } from '../autoCapture';

// ─── Tool Stream Registry ───────────────────────────────────────
// Set by runToolCallingLoop before each loop so file tools can emit
// stream.textEdit() calls, showing the "N files changed" diff UI.
let _toolStream: vscode.ChatResponseStream | undefined;

export function setToolStream(stream: vscode.ChatResponseStream | undefined): void {
	_toolStream = stream;
}

export function getToolStream(): vscode.ChatResponseStream | undefined {
	return _toolStream;
}

// ─── Re-exports ─────────────────────────────────────────────────

export { ProjectContextTool } from './projectContextTool';
export { TodoManagerTool } from './todoManagerTool';
export { SubagentTool } from './subagentTool';
export {
	WriteFileTool,
	ReplaceStringInFileTool,
	FileStatTool,
	RenameFileTool,
	DeleteFileTool,
	CopyFileTool,
	CreateDirectoryTool,
} from './fileTools';
export { SaveKnowledgeCardTool, EditKnowledgeCardTool, OrganizeKnowledgeCardsTool, GetCardTool } from './knowledgeCardTools';
export { SaveCacheTool, SearchCacheTool, ReadCacheTool, EditCacheTool } from './cacheTools';
export { SemanticSearchTool, CtxTool } from './searchTools';

// ─── Registration ───────────────────────────────────────────────

const registeredToolNames = new Set<string>();

function getOutputChannel(): { appendLine(msg: string): void } | undefined {
	try {
		const { outputChannel } = require('../extension');
		return outputChannel;
	} catch {
		return undefined;
	}
}

function safeRegisterTool(
	context: vscode.ExtensionContext,
	name: string,
	tool: vscode.LanguageModelTool<any>,
): void {
	// Guard: vscode.lm.registerTool requires VS Code 1.88+
	if (typeof (vscode.lm as any)?.registerTool !== 'function') {
		console.error(`[ContextManager] vscode.lm.registerTool is not available — cannot register '${name}'`);
		return;
	}
	try {
		const disposable = vscode.lm.registerTool(name, tool);
		context.subscriptions.push(disposable);
		registeredToolNames.add(name);
		console.log(`[ContextManager] ✓ Registered tool: ${name}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[ContextManager] ✗ FAILED to register tool '${name}':`, message, err);
	}
}

export function registerTools(
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
	cache: ExplanationCache,
	embeddingManager?: EmbeddingManager,
	searchIndex?: SearchIndex,
	autoCapture?: AutoCaptureService,
) {
	// CRITICAL: Clear the module-level Set on every activation.
	// Module-level variables survive deactivate()/activate() cycles (Node require
	// cache is NOT cleared), but context.subscriptions ARE disposed on deactivation,
	// which unregisters the tool implementations. Without this clear, subsequent
	// activations skip registration because the Set still contains old names.
	registeredToolNames.clear();

	// NOTE: contextManager_getProjectContext DEPRECATED in WS0b (Intelligence Pipeline Upgrade)
	// This "kitchen sink" tool mixed concerns (project meta, card index, cache, todos).
	// REPLACEMENT: Use contextManager_getKnowledgeCardsByCategory with detail="index" for card index,
	// contextManager_getCard to read full cards, and other specialized tools for cache/todos.
	// Keeping the class in projectContextTool.ts for reference but NOT registering the tool.
	// safeRegisterTool(context,
	// 	'contextManager_getProjectContext',
	// 	new ProjectContextTool(projectManager, cache)
	// );

	// TODO tool removed — TODOs are user-managed only, not created by agents

	// Register unified #ctx tool (merges search + intelligence + card read)
	if (searchIndex) {
		safeRegisterTool(context,
			'contextManager_ctx',
			new CtxTool(projectManager, searchIndex, autoCapture)
		);
	}

	// Get card by ID— convenience shortcut, kept alongside #ctx getCard mode
	safeRegisterTool(context,
		'contextManager_getCard',
		new GetCardTool(projectManager)
	);

	if (embeddingManager) {
		safeRegisterTool(context,
			'contextManager_semanticSearch',
			new SemanticSearchTool(projectManager, embeddingManager, searchIndex)
		);
	}

	// NOTE:File operation tools (writeFile, editFile, fileStat, renameFile,
	// deleteFile, copyFile, createDirectory) are NOT declared in package.json's
	// languageModelTools, so registerTool() would throw "was not contributed".
	// They are only used internally by the subagent tool-calling loop.

	// Register subagent tool (conditionally based on setting)
	if (ConfigurationManager.subagentEnabled) {
		safeRegisterTool(context,
			'contextManager_runSubagent',
			new SubagentTool(projectManager, cache, searchIndex)
		);
	}

	// ─── Background knowledge & cache tools ─────────────────────────
	// These run silently (no confirmation dialog) so the chat session is
	// not interrupted while saving or reading project memory.

	safeRegisterTool(context,
		'contextManager_saveKnowledgeCard',
		new SaveKnowledgeCardTool(projectManager)
	);

	safeRegisterTool(context,
		'contextManager_saveCache',
		new SaveCacheTool(cache, projectManager)
	);

	safeRegisterTool(context,
		'contextManager_searchCache',
		new SearchCacheTool(cache, projectManager, searchIndex)
	);

	safeRegisterTool(context,
		'contextManager_readCache',
		new ReadCacheTool(cache, projectManager)
	);

	safeRegisterTool(context,
		'contextManager_editKnowledgeCard',
		new EditKnowledgeCardTool(projectManager)
	);

	safeRegisterTool(context,
		'contextManager_organizeKnowledgeCards',
		new OrganizeKnowledgeCardsTool(projectManager)
	);

	safeRegisterTool(context,
		'contextManager_editCache',
		new EditCacheTool(cache)
	);

	console.log('[ContextManager] All tools registered.');
}
