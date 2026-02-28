/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts
 *  Version 3 — aligned with vscode-copilot-chat Feb 2026.
 *--------------------------------------------------------------------------------------------*/

// version: 3

declare module 'vscode' {

	export enum ChatSessionStatus {
		Failed = 0,
		Completed = 1,
		InProgress = 2,
	}

	export namespace chat {
		export function registerChatSessionItemProvider(
			chatSessionType: string,
			provider: ChatSessionItemProvider
		): Disposable;

		export function createChatSessionItemController(
			id: string,
			refreshHandler: () => Thenable<void>
		): ChatSessionItemController;

		export function registerChatSessionContentProvider(
			scheme: string,
			provider: ChatSessionContentProvider,
			chatParticipant: ChatParticipant,
			capabilities?: ChatSessionCapabilities
		): Disposable;
	}

	export interface ChatSessionItemProvider {
		readonly onDidChangeChatSessionItems: Event<void>;
		provideChatSessionItems(token: CancellationToken): ProviderResult<ChatSessionItem[]>;
	}

	export interface ChatSessionItemController {
		readonly id: string;
		dispose(): void;
		readonly items: ChatSessionItemCollection;
		createChatSessionItem(resource: Uri, label: string): ChatSessionItem;
		refreshHandler: () => Thenable<void>;
		readonly onDidArchiveChatSessionItem: Event<ChatSessionItem>;
	}

	export interface ChatSessionItemCollection extends Iterable<readonly [id: Uri, chatSessionItem: ChatSessionItem]> {
		readonly size: number;
		replace(items: readonly ChatSessionItem[]): void;
		forEach(callback: (item: ChatSessionItem, collection: ChatSessionItemCollection) => unknown, thisArg?: any): void;
		add(item: ChatSessionItem): void;
		delete(resource: Uri): void;
		get(resource: Uri): ChatSessionItem | undefined;
	}

	export interface ChatSessionItem {
		resource: Uri;
		label: string;
		iconPath?: IconPath;
		description?: string | MarkdownString;
		badge?: string | MarkdownString;
		status?: ChatSessionStatus;
		tooltip?: string | MarkdownString;
		archived?: boolean;
		timing?: {
			created: number;
			lastRequestStarted?: number;
			lastRequestEnded?: number;
		};
		changes?: readonly ChatSessionChangedFile[];
		metadata?: { readonly [key: string]: any };
	}

	export class ChatSessionChangedFile {
		modifiedUri: Uri;
		originalUri?: Uri;
		insertions: number;
		deletions: number;
		constructor(modifiedUri: Uri, insertions: number, deletions: number, originalUri?: Uri);
	}

	export interface ChatSession {
		readonly history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>;
		readonly requestHandler: ChatRequestHandler | undefined;
	}

	export interface ChatSessionContentProvider {
		readonly onDidChangeChatSessionOptions?: Event<ChatSessionOptionChangeEvent>;
		provideChatSessionContent(resource: Uri, token: CancellationToken): Thenable<ChatSession> | ChatSession;
	}

	export interface ChatSessionOptionChangeEvent {
		readonly resource: Uri;
		readonly updates: ReadonlyArray<{ readonly optionId: string; readonly value: string }>;
	}

	export interface ChatSessionCapabilities {
		supportsInterruptions?: boolean;
	}

	export interface ChatContext {
		readonly chatSessionContext?: ChatSessionContext;
	}

	export interface ChatSessionContext {
		readonly chatSessionItem: ChatSessionItem;
		readonly isUntitled: boolean;
	}
}
