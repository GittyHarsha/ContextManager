import * as vscode from 'vscode';

export interface SelectedContent {
	text: string;
	isSelection: boolean;  // true if multi-char selection, false if single symbol
	range: vscode.Range;
}

/**
 * Get the selected text or word under cursor.
 * Prioritizes explicit selection over word-at-cursor.
 */
export function getSelectedContent(editor: vscode.TextEditor): SelectedContent | undefined {
	// Prioritize explicit selection (user highlighted something)
	if (!editor.selection.isEmpty) {
		const text = editor.document.getText(editor.selection);
		if (text.trim()) {
			return {
				text: text.trim(),
				isSelection: true,
				range: editor.selection
			};
		}
	}

	// Fall back to word under cursor
	const position = editor.selection.active;
	const wordRange = editor.document.getWordRangeAtPosition(position);
	
	if (wordRange) {
		return {
			text: editor.document.getText(wordRange),
			isSelection: false,
			range: wordRange
		};
	}

	return undefined;
}

/**
 * Get the word (symbol) under the cursor.
 * @deprecated Use getSelectedContent instead
 */
export function getSymbolAtCursor(editor: vscode.TextEditor): string {
	const content = getSelectedContent(editor);
	return content?.text || '';
}

/**
 * Get the definition location of the symbol at the given position.
 * Uses the Language Server (clangd, etc.) via VS Code's definition provider.
 */
export async function getDefinitionLocation(
	uri: vscode.Uri,
	position: vscode.Position
): Promise<vscode.Location | undefined> {
	try {
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			uri,
			position
		);

		if (definitions && definitions.length > 0) {
			return definitions[0];
		}
	} catch (error) {
		console.error('Failed to get definition:', error);
	}

	return undefined;
}

/**
 * Get expanded range around a location for more context.
 * Expands the range to include surrounding lines.
 */
export async function getExpandedContext(
	location: vscode.Location,
	contextLines: number = 20
): Promise<vscode.Location> {
	const doc = await vscode.workspace.openTextDocument(location.uri);
	
	const startLine = Math.max(0, location.range.start.line - contextLines);
	const endLine = Math.min(doc.lineCount - 1, location.range.end.line + contextLines);
	
	return new vscode.Location(
		location.uri,
		new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length)
	);
}

/**
 * Get the current usage context (the selection or line the cursor is on).
 */
export function getUsageContext(editor: vscode.TextEditor): vscode.Range {
	if (!editor.selection.isEmpty) {
		// Use the selection
		return editor.selection;
	}
	
	// Expand to include a few lines around the cursor
	const position = editor.selection.active;
	const startLine = Math.max(0, position.line - 5);
	const endLine = Math.min(editor.document.lineCount - 1, position.line + 5);
	
	return new vscode.Range(
		startLine, 0,
		endLine, editor.document.lineAt(endLine).text.length
	);
}
