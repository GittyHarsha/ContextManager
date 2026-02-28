/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatStatusItem.d.ts
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatStatusItem {
		readonly id: string;
		title: string;
		description: string;
		detail?: string;
		show(): void;
		hide(): void;
		dispose(): void;
	}

	export namespace window {
		export function createChatStatusItem(id: string): ChatStatusItem;
	}
}
