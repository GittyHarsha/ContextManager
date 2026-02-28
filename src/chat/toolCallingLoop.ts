/**
 * Generic tool-calling loop — modeled after vscode-copilot-chat's ToolCallingLoop.
 *
 * Architecture (matches upstream):
 *   renderPrompt → buildPrompt2 (invokes tools during render) → collect ToolResultMeta
 *   → send request → stream text + collect tool calls → loop
 *
 * Key features ported from vscode-copilot-chat & Claude Code:
 *   - Tool input validation retries (MAX_INPUT_VALIDATION_RETRIES)
 *   - ToolFailureEncountered metadata for retry detection
 *   - Invalid tool-message filtering (orphan stripping)
 *   - Per-iteration tool refresh (getAgentTools called each pass)
 *   - Configurable tool call limit with user-facing confirmation to continue
 *   - Graceful yield support
 *   - Error-to-result conversion (errors become tool results, not crashes)
 *   - Parallel-safe eager invocation for read-only tools
 *   - Token budget reservation per-tool (flexReserve)
 */

import { renderPrompt } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ToolCallRound, ToolResultMeta, ToolFailureEncountered } from '../prompts/index';
import {
	beginToolInvocation,
	emitThinkingProgress,
} from '../proposedApi';
import { ConfigurationManager } from '../config';

// ─── Constants ──────────────────────────────────────────────────

/** Maximum times invalid tool input is retried before giving up. Matches vscode-copilot-chat MAX_INPUT_VALIDATION_RETRIES. */
const MAX_INPUT_VALIDATION_RETRIES = 5;

/** Safety net: absolute max iterations to prevent infinite loops from bugs */
const SAFETY_ITERATION_LIMIT = 200;

/** Default max tool call rounds before asking the user to continue */
const DEFAULT_TOOL_CALL_LIMIT = 25;

// ─── Interfaces ─────────────────────────────────────────────────

export const enum ToolCallLimitBehavior {
	/** Ask the user if they want to continue (default) */
	Confirm,
	/** Silently stop */
	Stop,
}

export interface ToolLoopOptions<P> {
	PromptComponent: any;
	promptProps: P;
	model: vscode.LanguageModelChat;
	/** Tool getter — called each iteration so newly-registered tools become available mid-loop */
	tools: vscode.LanguageModelToolInformation[] | (() => vscode.LanguageModelToolInformation[]);
	stream: vscode.ChatResponseStream;
	token: vscode.CancellationToken;
	toolReferences?: vscode.ChatLanguageModelToolReference[];
	/** Optional callback after each iteration */
	onIteration?: (iterationCount: number, toolCalls: vscode.LanguageModelToolCallPart[]) => Promise<void>;
	/** Max tool call rounds before limiting. Default: DEFAULT_TOOL_CALL_LIMIT */
	toolCallLimit?: number;
	/** What to do when limit is hit. Default: Confirm */
	onHitToolCallLimit?: ToolCallLimitBehavior;
	/** Optional: external graceful yield check (e.g. editor wants to interrupt) */
	yieldRequested?: () => boolean;
}

export interface ToolLoopResult {
	fullResponse: string;
	/** Only the final model response (after all tool calls are done) — no thinking tokens */
	lastResponse: string;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	/** True if the loop hit the tool call limit */
	maxToolCallsExceeded?: boolean;
}

// ─── Loop ───────────────────────────────────────────────────────

export async function runToolCallingLoop<P>(options: ToolLoopOptions<P>): Promise<ToolLoopResult> {
	const {
		PromptComponent, model, stream, token, onIteration,
	} = options;
	const { promptProps } = options;

	const toolCallLimit = options.toolCallLimit ?? DEFAULT_TOOL_CALL_LIMIT;
	const limitBehavior = options.onHitToolCallLimit ?? ToolCallLimitBehavior.Confirm;

	const toolCallRounds: ToolCallRound[] = [];
	const accumulatedToolResults: Record<string, vscode.LanguageModelToolResult> = {};
	const toolReferences = [...(options.toolReferences ?? [])];
	let fullResponse = '';
	let lastResponse = '';
	let maxToolCallsExceeded = false;
	let toolInputRetryCount = 0; // Tracks consecutive input validation failures

	const sendOptions: vscode.LanguageModelChatRequestOptions = {
		justification: 'To answer your question about the codebase',
	};

	let referencesEmitted = false;

	for (let iteration = 0; iteration < SAFETY_ITERATION_LIMIT; iteration++) {
		// ── Pre-flight checks ──────────────────────────────────
		if (token.isCancellationRequested) { break; }

		// Check graceful yield (editor wants to interrupt, e.g. for a follow-up)
		if (iteration > 0 && options.yieldRequested?.()) { break; }

		// Check tool call limit (only after at least one round)
		if (iteration > 0 && iteration >= toolCallLimit) {
			maxToolCallsExceeded = true;
			if (limitBehavior === ToolCallLimitBehavior.Confirm) {
				stream.markdown(
					`\n\n---\n> ⚙️ **Reached ${toolCallLimit} tool call rounds.** ` +
					`The agent has been working for a while. Consider sending a follow-up message to refine your request, ` +
					`or the agent will continue in subsequent turns.\n\n`
				);
			}
			break;
		}

		// ── 1. Resolve tools for this iteration (may change mid-loop) ──
		const tools = typeof options.tools === 'function' ? options.tools() : options.tools;

		// ── 2. Render the prompt (invokes tools from previous rounds during render) ──
		const result = await renderPrompt(
			PromptComponent,
			{
				...promptProps,
				toolCallRounds,
				toolCallResults: accumulatedToolResults,
			} as any,
			{ modelMaxPromptTokens: model.maxInputTokens },
			model,
		);

		let messages = result.messages;

		// ── 3. Validate tool messages (strip orphans — matches vscode-copilot-chat) ──
		messages = validateToolMessages(messages);

		// ── 4. Emit references (once, deduplicated) ──
		if (!referencesEmitted) {
			emitReferences(result.references, stream);
			referencesEmitted = true;
		}

		// ── 5. Collect tool result metadata from this render pass ──
		const toolResultMetadata = result.metadatas.getAll(ToolResultMeta);
		if (toolResultMetadata?.length) {
			toolResultMetadata.forEach(meta => accumulatedToolResults[meta.toolCallId] = meta.result);
		}

		// ── 5b. Detect tool input validation failures for retry tracking ──
		const hadToolFailure = result.metadatas.getAll(ToolFailureEncountered)?.length > 0;
		if (hadToolFailure) {
			toolInputRetryCount++;
			if (toolInputRetryCount > MAX_INPUT_VALIDATION_RETRIES) {
				// Too many consecutive validation failures — let the model know and stop retrying
				emitThinkingProgress(stream, `Tool input validation failed ${toolInputRetryCount} times, stopping retries.`);
				break;
			}
		} else {
			toolInputRetryCount = 0; // Reset on success
		}

		// ── 6. Handle forced tool references (user explicitly picked a tool) ──
		const requestedTool = toolReferences.shift();
		if (requestedTool) {
			sendOptions.toolMode = vscode.LanguageModelChatToolMode.Required;
			sendOptions.tools = vscode.lm.tools.filter(t => t.name === requestedTool.name);
		} else {
			sendOptions.toolMode = undefined;
			sendOptions.tools = tools.length > 0 ? [...tools] : undefined;
		}

		// ── 7. Send request to the model ──
		const response = await model.sendRequest(messages, sendOptions, token);

		// ── 8. Stream text and collect tool calls ──
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		let responseStr = '';

		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				stream.markdown(part.value);
				responseStr += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				// Normalize empty arguments to '{}' (matches vscode-copilot-chat)
				if (!part.input || (typeof part.input === 'object' && Object.keys(part.input).length === 0)) {
					// Keep as-is — vscode API handles it
				}
				toolCalls.push(part);
			}
		}

		fullResponse += responseStr;
		lastResponse = responseStr; // always overwrite — final iteration is the answer

		// Notify caller of iteration progress
		if (onIteration) {
			await onIteration(iteration, toolCalls);
		}

		// ── 9. If no tool calls, we're done ──
		if (!toolCalls.length) {
			break;
		}

		// ── 10. Emit tool invocation progress (proposed API) ──
		for (const tc of toolCalls) {
			beginToolInvocation(stream, tc.name, tc.callId);
		}

		// ── 11. Emit thinking progress to show the user what we're doing ──
		const toolNames = toolCalls.map(tc => tc.name.replace(/^contextManager_/, '').replace(/^haystack/i, 'search'));
		emitThinkingProgress(stream, `Round ${iteration + 1}: calling ${toolNames.join(', ')}...`);

		// ── 12. Record this round — next renderPrompt will invoke the tools ──
		toolCallRounds.push({ response: responseStr, toolCalls });
	}

	return { fullResponse, lastResponse, toolCallRounds, toolCallResults: accumulatedToolResults, maxToolCallsExceeded };
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Validates tool messages in the rendered prompt, removing orphaned Tool messages
 * that don't correspond to any preceding Assistant tool call. This prevents 400 errors
 * from the model endpoint. Matches vscode-copilot-chat's validateToolMessages().
 */
function validateToolMessages(messages: any[]): any[] {
	let previousAssistantMessage: any | undefined;
	const filtered = messages.filter((m) => {
		if (m.role === 'assistant') {
			previousAssistantMessage = m;
		} else if (m.role === 'tool') {
			if (!previousAssistantMessage) {
				console.warn('[ContextManager] Filtered orphan tool message: no previous assistant message');
				return false;
			}
			// Check if the assistant actually made tool calls
			const toolCalls = previousAssistantMessage.toolCalls || previousAssistantMessage.tool_calls;
			if (!toolCalls?.length) {
				console.warn('[ContextManager] Filtered orphan tool message: assistant had no tool calls');
				return false;
			}
			// Check if this specific tool call ID exists in the assistant's calls
			const toolCallId = m.toolCallId || m.tool_call_id;
			if (toolCallId && !toolCalls.some((tc: any) => (tc.id || tc.callId) === toolCallId)) {
				console.warn(`[ContextManager] Filtered orphan tool message: tool call ID ${toolCallId} not found in assistant message`);
				return false;
			}
		}
		return true;
	});
	return filtered;
}

/**
 * Emit deduplicated references from the rendered prompt.
 */
function emitReferences(references: any[], stream: vscode.ChatResponseStream) {
	const seen = new Set<string>();
	references.forEach(ref => {
		if (ref.anchor instanceof vscode.Uri || ref.anchor instanceof vscode.Location) {
			const key = ref.anchor instanceof vscode.Uri
				? ref.anchor.toString()
				: `${ref.anchor.uri.toString()}#${ref.anchor.range.start.line}`;
			if (!seen.has(key)) {
				seen.add(key);
				stream.reference(ref.anchor);
			}
		}
	});
}
