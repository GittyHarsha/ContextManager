/**
 * Shared prompt-tsx components used across all command prompts.
 * Follows the official vscode-copilot-chat pattern.
 */
import {
	AssistantMessage,
	BasePromptElementProps,
	Chunk,
	PrioritizedList,
	PromptElement,
	PromptMetadata,
	PromptPiece,
	PromptReference,
	PromptSizing,
	ToolCall,
	ToolMessage,
	UserMessage,
} from '@vscode/prompt-tsx';
import { ToolResult } from '@vscode/prompt-tsx/dist/base/promptElements';
import * as vscode from 'vscode';

// ─── Tool Call Types ────────────────────────────────────────────

export interface ToolCallRound {
	response: string;
	toolCalls: vscode.LanguageModelToolCallPart[];
}

export interface ToolCallsMetadata {
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
}

export interface ExplainerMetadata extends vscode.ChatResult {
	toolCallsMetadata: ToolCallsMetadata;
	command: string;
	cached: boolean;
}

export function isExplainerMetadata(obj: unknown): obj is ExplainerMetadata {
	return !!obj &&
		!!(obj as ExplainerMetadata).toolCallsMetadata &&
		Array.isArray((obj as ExplainerMetadata).toolCallsMetadata.toolCallRounds);
}

// ─── ToolResultMetadata ─────────────────────────────────────────

export class ToolResultMeta extends PromptMetadata {
	constructor(
		public toolCallId: string,
		public result: vscode.LanguageModelToolResult,
		public isCancelled: boolean = false,
	) {
		super();
	}
}

/**
 * Metadata marker emitted when a tool call fails (validation error, runtime error, etc.).
 * The loop uses this to track consecutive failures and stop retrying after MAX_INPUT_VALIDATION_RETRIES.
 * Matches vscode-copilot-chat's ToolFailureEncountered pattern.
 */
export class ToolFailureEncountered extends PromptMetadata {
	constructor(public toolCallId: string) {
		super();
	}
}

// ─── ToolCalls component ────────────────────────────────────────
// Renders accumulated tool call rounds + results.
// Tools are invoked during render via vscode.lm.invokeTool().

interface ToolCallsProps extends BasePromptElementProps {
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
}

const dummyCancellationToken: vscode.CancellationToken = new vscode.CancellationTokenSource().token;

export class ToolCalls extends PromptElement<ToolCallsProps, void> {
	async render(_state: void, _sizing: PromptSizing) {
		if (!this.props.toolCallRounds.length) {
			return undefined;
		}

		const totalRounds = this.props.toolCallRounds.length;

		// Use PrioritizedList so prompt-tsx prunes OLDER rounds first when
		// the token budget fills up. Recent rounds get higher priority —
		// this lets the model keep calling tools beyond 10-15 iterations
		// without losing sight of its latest discoveries.
		return <>
			<PrioritizedList priority={50} descending={false}>
				{this.props.toolCallRounds.map((round, idx) =>
					this.renderOneRound(round, idx, totalRounds)
				)}
			</PrioritizedList>
			<UserMessage priority={100}>
				Above is the result of calling one or more tools. The user cannot see the results, so you should explain them to the user if referencing them in your answer.
			</UserMessage>
		</>;
	}

	private renderOneRound(round: ToolCallRound, index: number, total: number) {
		const assistantToolCalls: ToolCall[] = round.toolCalls.map(tc => ({
			type: 'function',
			function: { name: tc.name, arguments: JSON.stringify(tc.input) },
			id: tc.callId,
		}));

		// Priority: recent rounds get higher values so they survive pruning.
		// Most recent round = total, oldest = 1.
		const priority = index + 1;

		return (
			<Chunk priority={priority}>
				<AssistantMessage toolCalls={assistantToolCalls}>{round.response}</AssistantMessage>
				{round.toolCalls.map(toolCall =>
					<ToolResultElement
						toolCall={toolCall}
						toolInvocationToken={this.props.toolInvocationToken}
						toolCallResult={this.props.toolCallResults[toolCall.callId]}
					/>
				)}
			</Chunk>
		);
	}
}

// ─── ToolResultElement ──────────────────────────────────────────
// Renders a single tool result — either from cache or by invoking the tool.

interface ToolResultElementProps extends BasePromptElementProps {
	toolCall: vscode.LanguageModelToolCallPart;
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined;
	toolCallResult: vscode.LanguageModelToolResult | undefined;
}

class ToolResultElement extends PromptElement<ToolResultElementProps, void> {
	async render(_state: void, sizing: PromptSizing): Promise<PromptPiece | undefined> {
		const tool = vscode.lm.tools.find(t => t.name === this.props.toolCall.name);
		if (!tool) {
			console.error(`[ContextManager] Tool not found: ${this.props.toolCall.name}`);
			return (
				<ToolMessage toolCallId={this.props.toolCall.callId}>
					<meta value={new ToolFailureEncountered(this.props.toolCall.callId)} />
					<meta value={new ToolResultMeta(this.props.toolCall.callId, new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Tool "${this.props.toolCall.name}" is not available. It may have been disabled or uninstalled.\nPlease check your input and try again.`)]))} />
					Tool "{this.props.toolCall.name}" is not available. It may have been disabled or uninstalled.{'\n'}Please check your input and try again.
				</ToolMessage>
			);
		}

		const tokenizationOptions: vscode.LanguageModelToolTokenizationOptions = {
			tokenBudget: sizing.tokenBudget,
			countTokens: async (content: string) => sizing.countTokens(content),
		};

		let toolResult: vscode.LanguageModelToolResult;
		let isCancelled = false;
		const extraMetadata: PromptMetadata[] = [];

		if (this.props.toolCallResult) {
			toolResult = this.props.toolCallResult;
		} else {
			try {
				toolResult = await vscode.lm.invokeTool(this.props.toolCall.name, {
					input: this.props.toolCall.input,
					toolInvocationToken: this.props.toolInvocationToken,
					tokenizationOptions,
				}, dummyCancellationToken);
			} catch (err: any) {
				// Error-to-result conversion (matches vscode-copilot-chat toolCallErrorToResult)
				const result = toolCallErrorToResult(err, this.props.toolCall.name);
				toolResult = result.toolResult;
				isCancelled = result.isCancelled;
				if (!isCancelled) {
					extraMetadata.push(new ToolFailureEncountered(this.props.toolCall.callId));
				}
			}
		}

		return (
			<ToolMessage toolCallId={this.props.toolCall.callId}>
				<meta value={new ToolResultMeta(this.props.toolCall.callId, toolResult, isCancelled)} />
				{...extraMetadata.map(m => <meta value={m} />)}
				<ToolResult data={toolResult} />
			</ToolMessage>
		);
	}
}

/**
 * Converts a tool invocation error to a structured tool result.
 * Matches vscode-copilot-chat's toolCallErrorToResult() pattern —
 * errors become tool results that the LLM can read and self-correct from,
 * rather than crashing the loop.
 */
function toolCallErrorToResult(err: unknown, toolName: string): { toolResult: vscode.LanguageModelToolResult; isCancelled: boolean } {
	// Check for cancellation (user or system)
	if (err instanceof vscode.CancellationError || (err as any)?.code === 'Cancellation') {
		return {
			toolResult: new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('The user cancelled the tool call.')]),
			isCancelled: true,
		};
	}

	const errorMessage = err instanceof Error ? err.message : String(err);
	console.error(`[ContextManager] Tool ${toolName} failed: ${errorMessage}`);

	return {
		toolResult: new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`ERROR while calling tool "${toolName}": ${errorMessage}\nPlease check your input and try again.`
		)]),
		isCancelled: false,
	};
}

// ─── History component ──────────────────────────────────────────
// Renders conversation history from previous turns, including tool calls.

interface HistoryProps extends BasePromptElementProps {
	context: vscode.ChatContext;
	priority: number;
}

export class History extends PromptElement<HistoryProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		return (
			<PrioritizedList priority={this.props.priority} descending={false}>
				{this.props.context.history.map(message => {
					if (message instanceof vscode.ChatRequestTurn) {
						return (
							<>
								{message.references && message.references.length > 0 && (
									<PromptReferences references={message.references} excludeReferences={true} />
								)}
								<UserMessage>{message.prompt}</UserMessage>
							</>
						);
					} else if (message instanceof vscode.ChatResponseTurn) {
						const metadata = message.result.metadata;
						if (isExplainerMetadata(metadata) && metadata.toolCallsMetadata.toolCallRounds.length > 0) {
							return <ToolCalls
								toolCallResults={metadata.toolCallsMetadata.toolCallResults}
								toolCallRounds={metadata.toolCallsMetadata.toolCallRounds}
								toolInvocationToken={undefined}
							/>;
						}
						return <AssistantMessage>{chatResponseToString(message)}</AssistantMessage>;
					}
				})}
			</PrioritizedList>
		);
	}
}

function chatResponseToString(response: vscode.ChatResponseTurn): string {
	return response.response
		.map(r => {
			if (r instanceof vscode.ChatResponseMarkdownPart) {
				return r.value.value;
			} else if (r instanceof vscode.ChatResponseAnchorPart) {
				if (r.value instanceof vscode.Uri) {
					return r.value.fsPath;
				} else {
					return r.value.uri.fsPath;
				}
			}
			return '';
		})
		.join('');
}

// ─── PromptReferences component ─────────────────────────────────
// Renders attached file references (Uri, Location, string).

interface PromptReferencesProps extends BasePromptElementProps {
	references?: ReadonlyArray<vscode.ChatPromptReference>;
	excludeReferences?: boolean;
}

export class PromptReferences extends PromptElement<PromptReferencesProps, void> {
	render(_state: void, _sizing: PromptSizing): PromptPiece | undefined {
		if (!this.props.references?.length) {
			return undefined;
		}
		// Filter out any invalid references
		const validRefs = this.props.references.filter(ref => ref && ref.value);
		if (!validRefs.length) {
			return undefined;
		}
		return (
			<UserMessage>
				{validRefs.map(ref => (
					<PromptReferenceElement reference={ref} excludeReferences={this.props.excludeReferences} />
				))}
			</UserMessage>
		);
	}
}

interface PromptReferenceElementProps extends BasePromptElementProps {
	reference: vscode.ChatPromptReference;
	excludeReferences?: boolean;
}

class PromptReferenceElement extends PromptElement<PromptReferenceElementProps> {
	async render(_state: void, _sizing: PromptSizing): Promise<PromptPiece | undefined> {
		if (!this.props.reference || !this.props.reference.value) {
			return undefined;
		}
		
		const value = this.props.reference.value;

		try {
			if (value instanceof vscode.Uri) {
				if (!value.fsPath) {
					return undefined;
				}
				const fileData = await vscode.workspace.fs.readFile(value);
				const fileContents = new TextDecoder().decode(fileData);
				return (
					<Tag name="context">
						{!this.props.excludeReferences && <references value={[new PromptReference(value)]} />}
						{value.fsPath}:<br />
						```<br />
						{fileContents}<br />
						```
					</Tag>
				);
			} else if (value instanceof vscode.Location) {
				if (!value.uri || !value.uri.fsPath || !value.range) {
					return undefined;
				}
				const doc = await vscode.workspace.openTextDocument(value.uri);
				const rangeText = doc.getText(value.range);
				return (
					<Tag name="context">
						{!this.props.excludeReferences && <references value={[new PromptReference(value)]} />}
						{value.uri.fsPath}:{value.range.start.line + 1}-{value.range.end.line + 1}:<br />
						```<br />
						{rangeText}<br />
						```
					</Tag>
				);
			} else if (typeof value === 'string') {
				return <Tag name="context">{value}</Tag>;
			}
		} catch (err) {
			console.warn('Failed to render reference:', err);
			return undefined;
		}

		return undefined;
	}
}

// ─── ProjectContext component ───────────────────────────────────
// Renders project context (knowledge cards, cached explanations, etc.)

interface ProjectContextProps extends BasePromptElementProps {
	projectContext: string;
	copilotInstructions?: string;
	workspacePaths: string[];
	priority: number;
}

export class ProjectContext extends PromptElement<ProjectContextProps, void> {
	render(_state: void, _sizing: PromptSizing): PromptPiece | undefined {
		const { projectContext, copilotInstructions, workspacePaths } = this.props;

		const hasContent = projectContext || copilotInstructions || workspacePaths.length > 0;
		if (!hasContent) {
			return undefined;
		}

		return (
			<UserMessage priority={this.props.priority}>
				{workspacePaths.length > 0 && <>
					## Workspace Paths<br />
					Use these absolute paths when calling search tools:<br />
					{workspacePaths.map(p => `- ${p}`).join('\n')}
				</>}
				{copilotInstructions && <>
					<br /><br />## Project Instructions (copilot-instructions.md)<br />
					{copilotInstructions}
				</>}
				{projectContext && <>
					<br /><br />## Project Context (pre-curated — do NOT re-derive or re-search this)<br />
					The following is user-curated context for this project. It includes project goals, conventions, knowledge cards, and cached code explanations that the user has explicitly selected for you to use. Treat this as authoritative ground truth — actively reference and apply it when answering, and do NOT waste tool calls trying to re-discover or verify information already provided here.<br /><br />
					{projectContext}
				</>}
			</UserMessage>
		);
	}
}

// ─── BranchContext component ────────────────────────────────────
// Renders branch session context (task, decisions, changed files, etc.)

interface BranchContextProps extends BasePromptElementProps {
	branchContext: string;
	priority: number;
}

export class BranchContext extends PromptElement<BranchContextProps, void> {
	render(_state: void, _sizing: PromptSizing): PromptPiece | undefined {
		if (!this.props.branchContext) {
			return undefined;
		}

		return (
			<UserMessage priority={this.props.priority}>
				## Branch Session Context (auto-injected)<br />
				The following is the saved session state for the currently active git branch. It includes the task being worked on, decisions made, approaches tried, changed files, and recent commits. Use this to continue the work seamlessly — do NOT re-ask the user for information already captured here.<br /><br />
				{this.props.branchContext}
			</UserMessage>
		);
	}
}

// ─── Tag helper ─────────────────────────────────────────────────

interface TagProps extends BasePromptElementProps {
	name: string;
	children?: any;
}

class Tag extends PromptElement<TagProps> {
	render() {
		return (
			<>
				{'<' + this.props.name + '>'}<br />
				{this.props.children}<br />
				{'</' + this.props.name + '>'}<br />
			</>
		);
	}
}

// ─── Reference Files component ──────────────────────────────────
// Renders reference file badges (not full content) from knowledge cards and cache entries

interface ReferenceFilesProps extends BasePromptElementProps {
	filePaths: string[];
	priority: number;
}

export class ReferenceFiles extends PromptElement<ReferenceFilesProps, void> {
	render(_state: void, _sizing: PromptSizing): PromptPiece | undefined {
		if (!this.props.filePaths.length) {
			return undefined;
		}

		// Convert file paths to Uri references (badges only, no file content)
		const references = this.props.filePaths
			.map(filePath => {
				try {
					return new PromptReference(vscode.Uri.file(filePath));
				} catch (err) {
					console.warn(`Failed to create reference for ${filePath}:`, err);
					return undefined;
				}
			})
			.filter((ref): ref is PromptReference => ref !== undefined);

		if (!references.length) {
			return undefined;
		}

		return <references value={references} />;
	}
}
