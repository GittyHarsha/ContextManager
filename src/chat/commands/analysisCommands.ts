/**
 * Analysis command handlers — /chat (default), /explain, /usage, /relationships, /doc.
 */

import * as vscode from 'vscode';
import { ExplanationCache, generateCacheKey } from '../../cache';
import { ConfigurationManager } from '../../config';
import { ProjectManager } from '../../projects/ProjectManager';
import {
	ChatPrompt,
	AnalysisPrompt,
	ExplainerMetadata,
	AnalysisCommand,
} from '../../prompts/index';
import {
	emitThinkingProgress,
	emitCodeblockUri,
} from '../../proposedApi';
import {
	getCopilotInstructions,
	getProjectContext,
	getBranchContext,
	getWorkspacePaths,
	getAgentTools,
	deselectContextAfterUse,
	autoSaveBranchSession,
	makeResult,
	noToolsResult,
} from '../helpers';
import { runToolCallingLoop } from '../toolCallingLoop';

// ─── /chat (default) ────────────────────────────────────────────

export async function handleChat(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const copilotInstructions = await getCopilotInstructions();
	const projCtx = await getProjectContext(projectManager, cache);
	const branchCtx = await getBranchContext(projectManager);
	const activeProject = projectManager.getActiveProject();
	const referenceFiles = activeProject ? projectManager.getReferenceFiles(activeProject.id, cache) : [];

	// Build project intelligence injection (tiered: conventions, tool hints, relevant notes)
	const intelligenceCtx = activeProject
		? await projectManager.getProjectIntelligenceString(
			activeProject.id,
			request.prompt,
			// Extract file paths from chat references
			request.references?.filter(r => r.value instanceof vscode.Uri).map(r => (r.value as vscode.Uri).fsPath)
		)
		: '';

	const result = await runToolCallingLoop({
		PromptComponent: ChatPrompt,
		promptProps: {
			request,
			context: chatContext,
			projectContext: projCtx + (intelligenceCtx ? '\n\n' + intelligenceCtx : ''),
			branchContext: branchCtx,
			copilotInstructions,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools, // function ref — refreshed per-iteration
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Auto-deselect context after use (fire-and-forget — never blocks the response)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	// Auto-save branch session (fire-and-forget — git snapshot runs in background)
	autoSaveBranchSession(projectManager, request.prompt, chatContext).catch(() => {});

	return makeResult('chat', result);
}

// ─── /explain, /usage, /relationships ───────────────────────────

export async function handleAnalysis(
	command: AnalysisCommand,
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const rawSymbol = request.prompt.trim();
	const cacheKey = generateCacheKey(command, rawSymbol, request.references);
	const activeProject = projectManager.getActiveProject();

	// If the prompt is multi-word (e.g. selected text), ask for a short title.
	let symbol = rawSymbol;
	if (rawSymbol.split(/\s+/).length > 1) {
		const userTitle = await vscode.window.showInputBox({
			title: 'Name this cache entry',
			prompt: 'The selected text is long. Provide a short title for the cache entry.',
			value: rawSymbol.length > 60 ? rawSymbol.substring(0, 60) + '\u2026' : rawSymbol,
			placeHolder: 'e.g. handleUserLogin flow',
		});
		if (userTitle?.trim()) {
			symbol = userTitle.trim();
		}
	}

	// Check cache
	const cached = cache.get(cacheKey, activeProject?.id);
	if (cached) {
		stream.markdown('*\uD83D\uDCDA Cached explanation:*\n\n');
		stream.markdown(cached);
		return noToolsResult(command, true);
	}

	stream.progress(`Analyzing ${symbol}...`);
	emitThinkingProgress(stream, `Researching ${symbol} across the codebase...`);

	const copilotInstructions = await getCopilotInstructions();
	const projCtx = await getProjectContext(projectManager, cache);
	const referenceFiles = activeProject ? projectManager.getReferenceFiles(activeProject.id, cache) : [];

	const result = await runToolCallingLoop({
		PromptComponent: AnalysisPrompt,
		promptProps: {
			request,
			context: chatContext,
			command,
			symbol,
			projectContext: projCtx,
			copilotInstructions,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools, // function ref — refreshed per-iteration
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Emit codeblockUri linking code blocks back to source files (proposed API)
	const firstRef = request.references?.[0];
	if (firstRef?.value instanceof vscode.Uri) {
		emitCodeblockUri(stream, firstRef.value);
	} else if (firstRef?.value instanceof vscode.Location) {
		emitCodeblockUri(stream, firstRef.value.uri);
	}

	// Cache the response
	if (result.fullResponse.trim()) {
		let filePath: string | undefined;
		let lineNumber: number | undefined;
		if (firstRef?.value instanceof vscode.Uri) {
			filePath = firstRef.value.fsPath;
		} else if (firstRef?.value instanceof vscode.Location) {
			filePath = firstRef.value.uri.fsPath;
			lineNumber = firstRef.value.range.start.line + 1;
		}
		cache.set(cacheKey, result.lastResponse || result.fullResponse, {
			symbolName: symbol,
			type: command,
			filePath,
			lineNumber,
			projectId: activeProject?.id,
		});
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult(command, result);
}

// ─── /doc (Experimental — proposed API) ─────────────────────────

export async function handleDoc(
	request: vscode.ChatRequest,
	_chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	// Check if experimental API is enabled
	if (!ConfigurationManager.experimentalProposedApi) {
		stream.markdown(
			'\u26A0\uFE0F **Experimental Feature**\n\n' +
			'The `/doc` command uses proposed VS Code APIs to apply inline edits.\n\n' +
			'To enable it:\n' +
			'1. Open Settings \u2192 search for `contextManager.experimental.enableProposedApi`\n' +
			'2. Enable it\n' +
			'3. Make sure you\'re running a VS Code build that supports proposed APIs (e.g. Insiders)\n'
		);
		return noToolsResult('doc');
	}

	// Check if stream.textEdit is available at runtime
	if (typeof (stream as any).textEdit !== 'function') {
		stream.markdown(
			'\u26A0\uFE0F **Not Available**\n\n' +
			'`stream.textEdit()` is not available in this VS Code build.\n' +
			'The `/doc` command requires VS Code Insiders or a build with `chatParticipantAdditions` proposed API support.\n'
		);
		return noToolsResult('doc');
	}

	// Get the active editor and selection
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		stream.markdown('**Error:** No active editor. Open a file and select code to document.');
		return noToolsResult('doc');
	}

	const selection = editor.selection;
	const selectedText = editor.document.getText(selection);
	if (!selectedText.trim()) {
		stream.markdown('**Error:** No code selected. Select the code you want to add documentation to.');
		return noToolsResult('doc');
	}

	const fileUri = editor.document.uri;
	const fileName = fileUri.fsPath.split(/[\\/]/).pop() || 'file';
	const languageId = editor.document.languageId;
	const additionalInstructions = request.prompt.trim();

	stream.progress(`Generating documentation for selected code in ${fileName}...`);

	// Build the prompt
	const projCtx = await getProjectContext(projectManager, cache);
	const systemPrompt = [
		'You are an expert code documentation writer.',
		'Generate comprehensive, idiomatic documentation comments for the given code.',
		'Use the appropriate comment style for the language (e.g., JSDoc for JS/TS, docstrings for Python, XML docs for C#, Doxygen for C/C++).',
		'Include: purpose, parameters, return values, exceptions/errors where applicable.',
		'Return ONLY the documented version of the code \u2014 the original code with doc comments added. Do not include any markdown fences or explanation.',
		projCtx ? `\nProject context for reference:\n${projCtx}` : '',
		additionalInstructions ? `\nAdditional instructions: ${additionalInstructions}` : '',
	].filter(Boolean).join('\n');

	const messages = [
		vscode.LanguageModelChatMessage.User(systemPrompt),
		vscode.LanguageModelChatMessage.User(
			`Language: ${languageId}\nFile: ${fileName}\n\nCode to document:\n${selectedText}`
		),
	];

	// Call the model
	const response = await request.model.sendRequest(messages, {}, token);
	let documentedCode = '';
	for await (const chunk of response.text) {
		documentedCode += chunk;
	}

	// Strip any markdown fences the model might have added
	documentedCode = documentedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');

	if (!documentedCode.trim()) {
		stream.markdown('**Error:** Failed to generate documentation. Try again with a different selection.');
		return noToolsResult('doc');
	}

	// Apply the edit via proposed API — shows inline diff
	const edit = vscode.TextEdit.replace(selection, documentedCode);
	(stream as any).textEdit(fileUri, edit);
	(stream as any).textEdit(fileUri, true); // signal done

	stream.markdown(`\n\n\u2705 Documentation generated for \`${fileName}\`. Review the inline diff above to accept or reject.`);

	return noToolsResult('doc');
}
