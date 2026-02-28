/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.mcpServerDefinitions.d.ts
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface McpServerDefinition {
		readonly label: string;
	}

	export namespace lm {
		export const mcpServerDefinitions: readonly McpServerDefinition[];
		export const onDidChangeMcpServerDefinitions: Event<void>;
	}
}
