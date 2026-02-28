/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Subset of chatParticipantAdditions v3 used by ContextManager.
 *  Full source: https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// ─── User Action Tracking ─────────────────────────────────────

	export interface ChatParticipant {
		readonly onDidPerformAction: Event<ChatUserActionEvent>;
		participantVariableProvider?: { provider: ChatParticipantCompletionItemProvider; triggerCharacters: string[] };
	}

	export enum ChatCopyKind {
		Action = 1,
		Toolbar = 2
	}

	export interface ChatCopyAction {
		kind: 'copy';
		codeBlockIndex: number;
		copyKind: ChatCopyKind;
		copiedCharacters: number;
		totalCharacters: number;
		copiedText: string;
	}

	export interface ChatInsertAction {
		kind: 'insert';
		codeBlockIndex: number;
		totalCharacters: number;
		newFile?: boolean;
	}

	export interface ChatApplyAction {
		kind: 'apply';
		codeBlockIndex: number;
		totalCharacters: number;
	}

	export interface ChatTerminalAction {
		kind: 'runInTerminal';
		codeBlockIndex: number;
	}

	export interface ChatCommandAction {
		kind: 'command';
		commandButton: { command: Command };
	}

	export interface ChatFollowupAction {
		kind: 'followUp';
		followup: ChatFollowup;
	}

	export interface ChatUserActionEvent {
		readonly result: ChatResult;
		readonly action: ChatCopyAction | ChatInsertAction | ChatApplyAction | ChatTerminalAction | ChatCommandAction | ChatFollowupAction;
	}

	// ─── Participant Variables ────────────────────────────────────

	export interface ChatParticipantCompletionItemProvider {
		provideCompletionItems(query: string, token: CancellationToken): ProviderResult<ChatCompletionItem[]>;
	}

	export class ChatCompletionItem {
		id: string;
		label: string | CompletionItemLabel;
		values: ChatVariableValue[];
		fullName?: string;
		icon?: ThemeIcon;
		insertText?: string;
		detail?: string;
		documentation?: string | MarkdownString;
		constructor(id: string, label: string | CompletionItemLabel, values: ChatVariableValue[]);
	}

	export interface ChatVariableValue {
		level: ChatVariableLevel;
		value: string | Uri;
		description?: string;
	}

	export enum ChatVariableLevel {
		Short = 1,
		Medium = 2,
		Full = 3
	}

	// ─── Question Carousel ────────────────────────────────────────

	export enum ChatQuestionType {
		Text = 1,
		SingleSelect = 2,
		MultiSelect = 3
	}

	export interface ChatQuestionOption {
		id: string;
		label: string;
		value: unknown;
	}

	export class ChatQuestion {
		id: string;
		type: ChatQuestionType;
		title: string;
		message?: string | MarkdownString;
		options?: ChatQuestionOption[];
		defaultValue?: string | string[];
		allowFreeformInput?: boolean;
		constructor(id: string, type: ChatQuestionType, title: string, options?: {
			message?: string | MarkdownString;
			options?: ChatQuestionOption[];
			defaultValue?: string | string[];
			allowFreeformInput?: boolean;
		});
	}

	export class ChatResponseQuestionCarouselPart {
		questions: ChatQuestion[];
		allowSkip: boolean;
		constructor(questions: ChatQuestion[], allowSkip?: boolean);
	}

	// ─── Code Block URI ───────────────────────────────────────────

	export class ChatResponseCodeblockUriPart {
		isEdit?: boolean;
		value: Uri;
		constructor(value: Uri, isEdit?: boolean);
	}

	// ─── Multi Diff ───────────────────────────────────────────────

	export interface ChatResponseDiffEntry {
		originalUri?: Uri;
		modifiedUri?: Uri;
		goToFileUri?: Uri;
		added?: number;
		removed?: number;
	}

	export class ChatResponseMultiDiffPart {
		value: ChatResponseDiffEntry[];
		title: string;
		readOnly?: boolean;
		constructor(value: ChatResponseDiffEntry[], title: string, readOnly?: boolean);
	}

	// ─── Text Edit / Confirmation / Warning ───────────────────────

	export class ChatResponseTextEditPart {
		uri: Uri;
		edits: TextEdit[];
		isDone?: boolean;
		constructor(uri: Uri, done: true);
		constructor(uri: Uri, edits: TextEdit | TextEdit[]);
	}

	export class ChatResponseConfirmationPart {
		title: string;
		message: string | MarkdownString;
		data: any;
		buttons?: string[];
		constructor(title: string, message: string | MarkdownString, data: any, buttons?: string[]);
	}

	export class ChatResponseWarningPart {
		value: MarkdownString;
		constructor(value: string | MarkdownString);
	}

	// ─── Move Part ────────────────────────────────────────────────

	export class ChatResponseMovePart {
		readonly uri: Uri;
		readonly range: Range;
		constructor(uri: Uri, range: Range);
	}

	// ─── Tool Invocation Streaming ────────────────────────────────

	export interface ChatToolInvocationStreamData {
		readonly partialInput?: unknown;
	}

	export class ChatToolInvocationPart {
		toolName: string;
		toolCallId: string;
		isError?: boolean;
		invocationMessage?: string | MarkdownString;
		pastTenseMessage?: string | MarkdownString;
		isConfirmed?: boolean;
		isComplete?: boolean;
		enablePartialUpdate?: boolean;
		constructor(toolName: string, toolCallId: string, isError?: boolean);
	}

	// ─── Thinking Progress ────────────────────────────────────────

	export class ChatResponseThinkingProgressPart {
		value: string | string[];
		id?: string;
		constructor(value: string | string[], id?: string);
	}

	// ─── Reference Part 2 ─────────────────────────────────────────

	export enum ChatResponseReferencePartStatusKind {
		Complete = 1,
		Partial = 2,
		Omitted = 3
	}

	export class ChatResponseReferencePart2 {
		value: Uri | Location | { variableName: string; value?: Uri | Location } | string;
		iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri };
		options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } };
		constructor(
			value: Uri | Location | { variableName: string; value?: Uri | Location } | string,
			iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri },
			options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } }
		);
	}

	// ─── Token Usage ──────────────────────────────────────────────

	export interface ChatResultPromptTokenDetail {
		readonly category: string;
		readonly label: string;
		readonly percentageOfPrompt: number;
	}

	export interface ChatResultUsage {
		readonly promptTokens: number;
		readonly completionTokens: number;
		readonly promptTokenDetails?: readonly ChatResultPromptTokenDetail[];
	}

	// ─── Chat Result Extensions ───────────────────────────────────

	export interface ChatResult {
		nextQuestion?: {
			prompt: string;
			participant?: string;
			command?: string;
		};
	}

	// ─── Stream Extensions ────────────────────────────────────────

	export interface ChatResponseStream {
		textEdit(target: Uri, edits: TextEdit | TextEdit[]): void;
		textEdit(target: Uri, isDone: true): void;
		confirmation(title: string, message: string | MarkdownString, data: any, buttons?: string[]): void;
		questionCarousel(questions: ChatQuestion[], allowSkip?: boolean): Thenable<Record<string, unknown> | undefined>;
		warning(message: string | MarkdownString): void;
		codeblockUri(uri: Uri, isEdit?: boolean): void;
		reference2(value: Uri | Location | string | { variableName: string; value?: Uri | Location }, iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri }, options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } }): void;
		beginToolInvocation(toolCallId: string, toolName: string, streamData?: ChatToolInvocationStreamData): void;
		updateToolInvocation(toolCallId: string, streamData: ChatToolInvocationStreamData): void;
		usage(usage: ChatResultUsage): void;
		push(part: ChatResponseTextEditPart | ChatResponseConfirmationPart | ChatResponseWarningPart | ChatResponseQuestionCarouselPart | ChatResponseMultiDiffPart | ChatResponseCodeblockUriPart | ChatResponseMovePart | ChatResponseThinkingProgressPart | ChatToolInvocationPart | ChatResponseReferencePart2): void;
	}

	export interface ChatRequest {
		readonly acceptedConfirmationData?: any[];
		readonly rejectedConfirmationData?: any[];
	}
}
