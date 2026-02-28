/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.languageModelToolSupportsModel.d.ts
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface LanguageModelToolDefinition extends LanguageModelToolInformation {
		displayName: string;
		toolReferenceName?: string;
		models?: string[];
		toolSet?: string;
	}

	export namespace lm {
		export function registerToolDefinition(toolDefinition: LanguageModelToolDefinition, tool: LanguageModelTool<object>): Disposable;
		export function invokeTool(toolId: string, options: LanguageModelToolInvocationOptions<object>, token: CancellationToken): Thenable<LanguageModelToolResult>;
	}
}
