import * as vscode from 'vscode';
import { ExplanationCache } from './cache';
import { ConfigurationManager } from './config';
import { 
	getSelectedContent,
	getSymbolAtCursor, 
	getDefinitionLocation, 
	getExpandedContext,
	getUsageContext 
} from './utils/symbolUtils';

/**
 * Register all context menu commands.
 */
export function registerCommands(
	context: vscode.ExtensionContext,
	cache: ExplanationCache
) {
	// Explain - works for both symbols and selections
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.explainSymbol', async () => {
			try {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					vscode.window.showWarningMessage('ContextManager: No active editor. Please open a file to explain code.');
					return;
				}

				const content = getSelectedContent(editor);
				if (!content) {
					vscode.window.showWarningMessage('ContextManager: No symbol or selection found. Please place cursor on a symbol or select text.');
					return;
				}

				const attachFiles: { uri: vscode.Uri; range?: vscode.Range }[] = [];
				
				if (content.isSelection) {
					// For selections, attach the selected range directly
					attachFiles.push({ uri: editor.document.uri, range: content.range });
				} else {
					// For symbols, try to get definition for richer context
					if (ConfigurationManager.explanationExpandContext) {
						const definition = await getDefinitionLocation(
							editor.document.uri,
							editor.selection.active
						);
						
						if (definition) {
							const expanded = await getExpandedContext(definition);
							attachFiles.push({ uri: expanded.uri, range: expanded.range });
						}
					}
				}

				// Open chat with pre-filled query
				await vscode.commands.executeCommand('workbench.action.chat.open', {
					query: `@ctx /explain ${content.text}`,
					isPartialQuery: false,
					attachFiles
				});
			} catch (error) {
				console.error('Error in explainSymbol command:', error);
				vscode.window.showErrorMessage('ContextManager: Failed to explain symbol. Please try again.');
			}
		})
	);

	// Explain Usage - explains why a symbol is used at this location
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.explainUsage', async () => {
			try {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					vscode.window.showWarningMessage('ContextManager: No active editor. Please open a file to explain code usage.');
					return;
				}

				const content = getSelectedContent(editor);
				if (!content) {
					vscode.window.showWarningMessage('ContextManager: No symbol or selection found. Please place cursor on a symbol or select text.');
					return;
				}

				// Get the usage context (surrounding code)
				const usageRange = getUsageContext(editor);
				
				// Build attach files - include usage site
				const attachFiles: { uri: vscode.Uri; range?: vscode.Range }[] = [
					{ uri: editor.document.uri, range: usageRange }
				];

				// For symbols, also get definition
				if (!content.isSelection && ConfigurationManager.explanationExpandContext) {
					const definition = await getDefinitionLocation(
						editor.document.uri,
						editor.selection.active
					);
					if (definition) {
						const expanded = await getExpandedContext(definition);
						attachFiles.push({ uri: expanded.uri, range: expanded.range });
					}
				}

				await vscode.commands.executeCommand('workbench.action.chat.open', {
					query: `@ctx /usage ${content.text}`,
					isPartialQuery: false,
					attachFiles
				});
			} catch (error) {
				console.error('Error in explainUsage command:', error);
				vscode.window.showErrorMessage('ContextManager: Failed to explain usage. Please try again.');
			}
		})
	);

	// Explain Relationships - explains class hierarchy and dependencies
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.explainRelationships', async () => {
			try {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					vscode.window.showWarningMessage('ContextManager: No active editor. Please open a file to explain relationships.');
					return;
				}

				const content = getSelectedContent(editor);
				if (!content) {
					vscode.window.showWarningMessage('ContextManager: No symbol or selection found. Please place cursor on a symbol or select text.');
					return;
				}

				const attachFiles: { uri: vscode.Uri; range?: vscode.Range }[] = [];

				if (content.isSelection) {
					// For selections, attach the selected range
					attachFiles.push({ uri: editor.document.uri, range: content.range });
				} else {
					// For symbols, get definition with expanded context
					if (ConfigurationManager.explanationExpandContext) {
						const definition = await getDefinitionLocation(
							editor.document.uri,
							editor.selection.active
						);

						if (definition) {
							const expanded = await getExpandedContext(definition, 100);
							attachFiles.push({ uri: expanded.uri, range: expanded.range });
						}
					}
				}

				await vscode.commands.executeCommand('workbench.action.chat.open', {
					query: `@ctx /relationships ${content.text}`,
					isPartialQuery: false,
					attachFiles
				});
			} catch (error) {
				console.error('Error in explainRelationships command:', error);
				vscode.window.showErrorMessage('ContextManager: Failed to explain relationships. Please try again.');
			}
		})
	);

	// Clear Cache command
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.clearCache', async () => {
			try {
				const size = cache.size();
				
				if (size === 0) {
					vscode.window.showInformationMessage('ContextManager: Cache is already empty.');
					return;
				}

				const result = await vscode.window.showWarningMessage(
					`Clear ${size} cached explanation${size !== 1 ? 's' : ''}? This cannot be undone.`,
					{ modal: ConfigurationManager.confirmDelete },
					'Clear Cache',
					'Cancel'
				);

				if (result === 'Clear Cache') {
					cache.clear();
					vscode.window.showInformationMessage(
						`ContextManager: Cleared ${size} cached explanation${size !== 1 ? 's' : ''}.`
					);
				}
			} catch (error) {
				console.error('Error in clearCache command:', error);
				vscode.window.showErrorMessage('ContextManager: Failed to clear cache. Please try again.');
			}
		})
	);
}
