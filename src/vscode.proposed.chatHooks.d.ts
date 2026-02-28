/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatHooks.d.ts
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export type ChatHookType = 'SessionStart' | 'UserPromptSubmit' | 'ParticipantPromptSubmit' | 'ModelResponse' | 'UserPromptDisplay' | 'Confirmation';

	export interface ChatHookCommand {
		hookTypes: ChatHookType[];
		command: Command;
		exclusive?: boolean;
	}

	export interface ChatRequestHooks {
		readonly hookType: ChatHookType;
		readonly participant?: string;
		readonly prompt?: string;
		readonly command?: string;
		readonly confirmation?: { accepted: boolean; data: unknown };
	}

	export type ChatHookResult = void | { prompt?: string; stopExecution?: boolean };

	export interface ChatResponseHookPart {
		hookType: ChatHookType;
		status?: 'running' | 'done' | 'error';
		message?: string | MarkdownString;
	}

	export interface ChatResponseStream {
		hookProgress(hookType: ChatHookType, status: 'running' | 'done' | 'error', message?: string | MarkdownString): void;
	}

	export interface ChatParticipant {
		chatHooks?: ChatHookCommand[];
	}
}
