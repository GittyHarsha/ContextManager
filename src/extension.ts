import * as vscode from 'vscode';
import { ExplanationCache } from './cache';
import { registerCommands } from './commands';
import { ConfigurationManager } from './config';
import { ProjectManager } from './projects/ProjectManager';
import { registerSidebar } from './sidebar/ProjectsTreeProvider';
import { DashboardPanel } from './dashboard';
import { registerTools } from './tools';
import { SearchIndex } from './search/SearchIndex';
import { initBackgroundTasks, getLastChatExchange } from './backgroundTasks';
import { AutoCaptureService } from './autoCapture';
import { HookWatcher, SCRIPTS_DIR, QUEUE_FILE } from './hooks/HookWatcher';
import { GitHubInstructionsManager } from './githubInstructions';
import { WorkflowEngine } from './workflows/WorkflowEngine';

let statusBarItem: vscode.StatusBarItem;

// Output channel for runtime diagnostics
export let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	try {
		outputChannel = vscode.window.createOutputChannel('ContextManager');
		context.subscriptions.push(outputChannel);
		outputChannel.appendLine('[ContextManager] Extension activating...');
		console.log('ContextManager extension is now active');

		// ── Cross-publisher data migration ──────────────────────────
		// If the current globalStorage is empty but data exists under a
		// different publisher directory (e.g. local-dev vs HarshaNarayanaP),
		// copy all data files over so users don't lose their projects.
		migrateFromAlternatePublisher(context);

		// Initialize project manager
		const projectManager = new ProjectManager(context);

		// Initialize the explanation cache
		const cache = new ExplanationCache(context);

		// Initialize background task manager
		initBackgroundTasks(context, projectManager, cache);

		// Create status bar item showing current project
		statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		statusBarItem.command = 'contextManager.openDashboard';
		statusBarItem.tooltip = 'Click to open ContextManager Dashboard';
		context.subscriptions.push(statusBarItem);

		// Update status bar when project changes
		const updateStatusBar = () => {
			if (!ConfigurationManager.showStatusBar) {
				statusBarItem.hide();
				return;
			}

			const activeProject = projectManager.getActiveProject();
			if (activeProject) {
				const cardCount = activeProject.selectedCardIds?.length || 0;
				statusBarItem.text = `$(book) ${activeProject.name}`;
				statusBarItem.tooltip = new vscode.MarkdownString(
					`**Project:** ${activeProject.name}\n\n` +
					`**Knowledge:** ${cardCount} cards selected\n\n` +
					`**Cache:** ${cache.getEntriesForProject(activeProject.id).length} explanations\n\n` +
					`_Click to open dashboard_`
				);
				statusBarItem.show();
			} else {
				statusBarItem.text = '$(book) No Project';
				statusBarItem.tooltip = 'Click to create or select a project';
				statusBarItem.show();
			}
		};

		// Initial update and subscribe to changes
		updateStatusBar();
		projectManager.onDidChangeActiveProject(() => updateStatusBar());
		projectManager.onDidChangeProjects(() => updateStatusBar());
		cache.onDidChangeCache(() => updateStatusBar());

		// Watch for configuration changes
		context.subscriptions.push(
			ConfigurationManager.onDidChange(e => {
				if (ConfigurationManager.didChange(e, 'showStatusBar')) {
					updateStatusBar();
				}
			})
		);

		// Register sidebar tree view
		const treeProvider = registerSidebar(context, projectManager);

		// Initialize Auto-Capture service
		const autoCapture = new AutoCaptureService(context, projectManager);
		outputChannel.appendLine('[ContextManager] Auto-capture initialized');

		// Initialize centralized WorkflowEngine singleton
		const workflowEngine = new WorkflowEngine(projectManager);
		workflowEngine.setAutoCapture(autoCapture);
		projectManager.setWorkflowEngine(workflowEngine);
		autoCapture.setWorkflowEngine(workflowEngine);
		outputChannel.appendLine('[ContextManager] WorkflowEngine initialized');

		// Initialize Hook Watcher — ingests captures from .github/hooks/ agent hook scripts
		const hookWatcher = new HookWatcher(autoCapture, projectManager, workflowEngine);
		context.subscriptions.push(hookWatcher);
		outputChannel.appendLine(`[ContextManager] HookWatcher started — queue: ${QUEUE_FILE}`);

		// Auto-install hooks if not already present in the active project (silent, no prompts)
		// Also detect stale scripts via cm-version header and silently overwrite
		setTimeout(() => {
			try {
				const fs = require('fs') as typeof import('fs');
				const pathMod = require('path') as typeof import('path');
				const project = projectManager.getActiveProject();
				if (!project?.rootPaths?.[0]) { return; }
				const hooksFile = pathMod.join(project.rootPaths[0], '.github', 'hooks', 'contextmanager-hooks.json');
				const hooksFileValid = (() => {
					try {
						if (!fs.existsSync(hooksFile)) { return false; }
						const content = fs.readFileSync(hooksFile, 'utf8').trim();
						if (!content || content.length < 10) { return false; }
						const parsed = JSON.parse(content);
						return parsed && typeof parsed === 'object' && parsed.hooks;
					} catch { return false; }
				})();
				if (!hooksFileValid) {
					vscode.commands.executeCommand('contextManager.installHooks');
					outputChannel.appendLine('[ContextManager] Auto-installing hooks (missing or invalid hooks file)');
				} else {
					// Check if installed scripts are stale by comparing cm-version header
					const isWindows = process.platform === 'win32';
					const installedScript = pathMod.join(SCRIPTS_DIR, isWindows ? 'capture.ps1' : 'capture.sh');
					const bundledScript = pathMod.join(context.extensionUri.fsPath, 'resources', 'hooks', isWindows ? 'capture.ps1' : 'capture.sh');
					const parseVersion = (filePath: string): number => {
						try {
							const head = fs.readFileSync(filePath, 'utf8').substring(0, 500);
							const match = head.match(/cm-version:\s*(\d+)/);
							return match ? parseInt(match[1], 10) : 0;
						} catch { return 0; }
					};
					if (fs.existsSync(installedScript)) {
						const installed = parseVersion(installedScript);
						const bundled = parseVersion(bundledScript);
						if (bundled > installed) {
							vscode.commands.executeCommand('contextManager.installHooks');
							outputChannel.appendLine(`[ContextManager] Auto-updating stale hooks (v${installed} → v${bundled})`);
						}
					}
				}
			} catch (e) { /* non-critical */ }
		}, 4_000);

		// Register context menu commands
		registerCommands(context, cache);

		// Initialize BM25 full-text search index (SQLite FTS4 via sql.js WASM)
		let searchIndex: SearchIndex | undefined;
		if (ConfigurationManager.searchEnableFTS) {
			searchIndex = new SearchIndex(context);
			context.subscriptions.push(searchIndex);

		// Wire up search index to ProjectManager and Cache for incremental updates
			projectManager.setSearchIndex(searchIndex);
			cache.setSearchIndex(searchIndex);
			autoCapture.setSearchIndex(searchIndex);

			// Deferred init: don't block activation — start after a short delay.
			// Incremental methods auto-initialize on first call, so this only
			// pre-warms the WASM engine and decides whether a full rebuild is needed.
			setTimeout(async () => {
				try {
					await searchIndex!.initialize();
					if (searchIndex!.needsRebuild) {
						// Fresh DB (no saved data) — full rebuild required
						const projects = projectManager.getAllProjects();
						const cacheEntries = cache.getAllEntries();
						await searchIndex!.rebuild(projects, cacheEntries);
						console.log('ContextManager: FTS4 search index built (fresh DB)');
					} else {
						console.log('ContextManager: FTS4 search index restored from disk');
					}
				} catch (err) {
					console.error('ContextManager: Failed to initialize/build FTS4 search index:', err);
				}
			}, 2_000); // 2s delay keeps activation fast
		}

		// Register Language Model Tools for cross-participant context sharing
		registerTools(context, projectManager, searchIndex, autoCapture);

		// Initialize GitHub Instructions Manager — syncs .github/ files when cards change
		const instructionsManager = new GitHubInstructionsManager(projectManager);
		let instructionsSyncTimer: ReturnType<typeof setTimeout> | undefined;
		const debouncedInstructionsSync = () => {
			if (instructionsSyncTimer) { clearTimeout(instructionsSyncTimer); }
			instructionsSyncTimer = setTimeout(() => instructionsManager.syncInstructions(), 5_000);
		};
		projectManager.onDidChangeProjects(() => debouncedInstructionsSync());
		projectManager.onDidChangeActiveProject(() => debouncedInstructionsSync());
		// Initial sync after a delay to avoid blocking activation
		setTimeout(() => instructionsManager.syncInstructions(), 10_000);

		// Log registered tools after a short delay (tools appear in vscode.lm.tools asynchronously)
		setTimeout(() => {
			const tools = vscode.lm.tools;
			outputChannel.appendLine(`[ContextManager] vscode.lm.tools (${tools.length} total):`);
			tools.forEach(t => outputChannel.appendLine(`  - ${t.name}`));
			const ourTools = tools.filter(t => t.name.toLowerCase().startsWith('contextmanager_'));
			outputChannel.appendLine(`[ContextManager] Our tools visible to agents: ${ourTools.length}`);
			ourTools.forEach(t => outputChannel.appendLine(`  ✓ ${t.name}`));
		}, 3000);

		// Register dashboard command
		context.subscriptions.push(
			vscode.commands.registerCommand('contextManager.openDashboard', (projectId?: string, tab?: string) => {
				try {
					DashboardPanel.createOrShow(context.extensionUri, projectManager, cache, projectId, tab, autoCapture, hookWatcher);
				} catch (error) {
					console.error('Failed to open dashboard:', error);
					vscode.window.showErrorMessage('Failed to open ContextManager dashboard. Please try again.');
				}
			})
		);

		// Register manual capture command
		context.subscriptions.push(
			vscode.commands.registerCommand('contextManager.installHooks', async () => {
				const fs = require('fs') as typeof import('fs');
				const pathMod = require('path') as typeof import('path');
				const activeProject = projectManager.getActiveProject();
				if (!activeProject?.rootPaths?.[0]) {
					vscode.window.showWarningMessage('No active project with a root path. Set one first.');
					return;
				}
				const rootPath = activeProject.rootPaths[0];
				const hooksDir = pathMod.join(rootPath, '.github', 'hooks');

				try {
					// 1. Ensure ~/.contextmanager/scripts/ and .github/hooks/ exist
					fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
					fs.mkdirSync(hooksDir, { recursive: true });

					// 2. Copy capture scripts to ~/.contextmanager/scripts/
					const resHooks = pathMod.join(context.extensionUri.fsPath, 'resources', 'hooks');
					fs.copyFileSync(pathMod.join(resHooks, 'capture.ps1'), pathMod.join(SCRIPTS_DIR, 'capture.ps1'));
					fs.copyFileSync(pathMod.join(resHooks, 'capture.sh'),  pathMod.join(SCRIPTS_DIR, 'capture.sh'));
					// Make sh executable on Unix
					try { fs.chmodSync(pathMod.join(SCRIPTS_DIR, 'capture.sh'), 0o755); } catch {}

					// 3. Generate hooks.json with actual absolute paths
					const templatePath = pathMod.join(resHooks, 'hooks.json');
					let hooksJson = fs.readFileSync(templatePath, 'utf8');
					const unixDir = SCRIPTS_DIR.replace(/\\/g, '/');
					const winDir  = SCRIPTS_DIR.replace(/\//g, '\\');
					// Double-escape backslashes for JSON embedding (single \ is invalid in JSON strings)
					const winDirJson = winDir.replace(/\\/g, '\\\\');
					hooksJson = hooksJson
						.replace(/%CM_SCRIPTS_DIR_UNIX%/g, unixDir)
						.replace(/%CM_SCRIPTS_DIR_WIN%/g,  winDirJson);
					fs.writeFileSync(pathMod.join(hooksDir, 'contextmanager-hooks.json'), hooksJson, 'utf8');

					vscode.window.showInformationMessage(
						`✅ Hooks installed! Scripts → ${SCRIPTS_DIR}  |  Config → ${hooksDir}`,
						'Open Hooks Dir'
					).then(sel => {
						if (sel === 'Open Hooks Dir') {
							vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(hooksDir));
						}
					});
					outputChannel.appendLine(`[ContextManager] Hooks installed to ${hooksDir}`);
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to install hooks: ${err.message}`);
					console.error('[ContextManager] installHooks failed:', err);
				}
			}),
			vscode.commands.registerCommand('contextManager.installCopilotCliPluginHooks', async () => {
				const fs = require('fs') as typeof import('fs');
				const pathMod = require('path') as typeof import('path');
				const activeProject = projectManager.getActiveProject();
				if (!activeProject?.rootPaths?.[0]) {
					vscode.window.showWarningMessage('No active project with a root path. Set one first.');
					return;
				}

				const rootPath = activeProject.rootPaths[0];
				const hooksDir = pathMod.join(rootPath, '.github', 'hooks');
				const pluginScriptsDir = pathMod.join(SCRIPTS_DIR, 'copilot-cli');
				const hookConfigPath = pathMod.join(hooksDir, 'contextmanager-copilot-cli-hooks.json');

				try {
					fs.mkdirSync(pluginScriptsDir, { recursive: true });
					fs.mkdirSync(hooksDir, { recursive: true });

					const pluginScriptsSourceDir = pathMod.join(context.extensionUri.fsPath, 'plugin', 'scripts');
					for (const fileName of ['capture.ps1', 'capture.sh', 'write-intent.ps1', 'write-intent.sh']) {
						fs.copyFileSync(pathMod.join(pluginScriptsSourceDir, fileName), pathMod.join(pluginScriptsDir, fileName));
					}
					try { fs.chmodSync(pathMod.join(pluginScriptsDir, 'capture.sh'), 0o755); } catch {}
					try { fs.chmodSync(pathMod.join(pluginScriptsDir, 'write-intent.sh'), 0o755); } catch {}

					const bashCapture = pathMod.join(pluginScriptsDir, 'capture.sh').replace(/\\/g, '/');
					const bashCaptureCommand = `bash \"${bashCapture}\"`;
					const powershellCapture = pathMod.join(pluginScriptsDir, 'capture.ps1').replace(/\//g, '\\\\');
					const powershellCaptureCommand = `powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -File \"${powershellCapture}\"`;

					const hookConfig = {
						version: 1,
						hooks: {
							sessionStart: [{
								type: 'command',
								bash: bashCaptureCommand,
								powershell: powershellCaptureCommand,
								env: {
									CM_HOOK_TYPE: 'SessionStart',
									CM_PLUGIN_ORIGIN: 'copilot-cli-plugin',
									CM_PLUGIN_PARTICIPANT: 'copilot-cli',
								},
								timeoutSec: 10,
							}],
							userPromptSubmitted: [{
								type: 'command',
								bash: bashCaptureCommand,
								powershell: powershellCaptureCommand,
								env: {
									CM_HOOK_TYPE: 'UserPromptSubmitted',
									CM_PLUGIN_ORIGIN: 'copilot-cli-plugin',
									CM_PLUGIN_PARTICIPANT: 'copilot-cli',
								},
								timeoutSec: 10,
							}],
							postToolUse: [{
								type: 'command',
								bash: bashCaptureCommand,
								powershell: powershellCaptureCommand,
								env: {
									CM_HOOK_TYPE: 'PostToolUse',
									CM_PLUGIN_ORIGIN: 'copilot-cli-plugin',
									CM_PLUGIN_PARTICIPANT: 'copilot-cli',
								},
								timeoutSec: 15,
							}],
							errorOccurred: [{
								type: 'command',
								bash: bashCaptureCommand,
								powershell: powershellCaptureCommand,
								env: {
									CM_HOOK_TYPE: 'ErrorOccurred',
									CM_PLUGIN_ORIGIN: 'copilot-cli-plugin',
									CM_PLUGIN_PARTICIPANT: 'copilot-cli',
								},
								timeoutSec: 15,
							}],
							sessionEnd: [{
								type: 'command',
								bash: bashCaptureCommand,
								powershell: powershellCaptureCommand,
								env: {
									CM_HOOK_TYPE: 'SessionEnd',
									CM_PLUGIN_ORIGIN: 'copilot-cli-plugin',
									CM_PLUGIN_PARTICIPANT: 'copilot-cli',
								},
								timeoutSec: 10,
							}],
						},
					};

					fs.writeFileSync(hookConfigPath, `${JSON.stringify(hookConfig, null, '\t')}\n`, 'utf8');

					vscode.window.showInformationMessage(
						`✅ Copilot CLI hook scaffold installed. Scripts → ${pluginScriptsDir} | Config → ${hookConfigPath}`,
						'Open Hooks Dir',
						'Open Scripts Dir'
					).then(sel => {
						if (sel === 'Open Hooks Dir') {
							vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(hooksDir));
						} else if (sel === 'Open Scripts Dir') {
							vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pluginScriptsDir));
						}
					});
					outputChannel.appendLine(`[ContextManager] Copilot CLI hook scaffold installed to ${hookConfigPath}`);
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to install Copilot CLI hook scaffold: ${err.message}`);
					console.error('[ContextManager] installCopilotCliPluginHooks failed:', err);
				}
			}),
			vscode.commands.registerCommand('contextManager.openPluginScaffold', async () => {
				const pathMod = require('path') as typeof import('path');
				const fs = require('fs') as typeof import('fs');
				const pluginDir = pathMod.join(context.extensionUri.fsPath, 'plugin');
				if (!fs.existsSync(pluginDir)) {
					vscode.window.showWarningMessage('Plugin scaffold not found in this ContextManager install.');
					return;
				}

				const readmePath = pathMod.join(pluginDir, 'README.md');
				const selection = await vscode.window.showInformationMessage(
					'ContextManager Copilot CLI plugin is available in the extension folder. Preferred install: copilot plugin install ./plugin. The VS Code command installs a repo hook config instead.',
					'Install Copilot CLI Plugin Hooks',
					'Open Folder',
					'Open README'
				);

				if (selection === 'Install Copilot CLI Plugin Hooks') {
					await vscode.commands.executeCommand('contextManager.installCopilotCliPluginHooks');
					return;
				}

				if (selection === 'Open README' && fs.existsSync(readmePath)) {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(readmePath));
					await vscode.window.showTextDocument(doc, { preview: false });
					return;
				}

				if (selection === 'Open Folder') {
					await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pluginDir));
				}
			}),
			vscode.commands.registerCommand('contextManager.installClaudeCodeHooks', async () => {
				const fs = require('fs') as typeof import('fs');
				const pathMod = require('path') as typeof import('path');
				const activeProject = projectManager.getActiveProject();
				if (!activeProject?.rootPaths?.[0]) {
					vscode.window.showWarningMessage('No active project with a root path. Set one first.');
					return;
				}

				const rootPath = activeProject.rootPaths[0];

				try {
					// 1. Ensure capture scripts are installed
					fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
					const resHooks = pathMod.join(context.extensionUri.fsPath, 'resources', 'hooks');
					fs.copyFileSync(pathMod.join(resHooks, 'capture.ps1'), pathMod.join(SCRIPTS_DIR, 'capture.ps1'));
					fs.copyFileSync(pathMod.join(resHooks, 'capture.sh'), pathMod.join(SCRIPTS_DIR, 'capture.sh'));
					try { fs.chmodSync(pathMod.join(SCRIPTS_DIR, 'capture.sh'), 0o755); } catch {}

					// 2. Build the Claude Code hook config
					const captureShUnix = pathMod.join(SCRIPTS_DIR, 'capture.sh').replace(/\\/g, '/');
					const capturePsWin = pathMod.join(SCRIPTS_DIR, 'capture.ps1');
					const isWin = process.platform === 'win32';
					const captureCmd = isWin
						? `powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -File "${capturePsWin}"`
						: `bash "${captureShUnix}"`;

					const hookEntry = [{ type: 'command' as const, command: captureCmd }];
					const hookConfig: Record<string, unknown> = {
						hooks: {
							Stop: hookEntry,
							PreToolUse: hookEntry,
							PostToolUse: hookEntry,
							PreCompact: hookEntry,
						},
					};

					// 3. Write to .claude/settings.json, merging with existing
					const claudeDir = pathMod.join(rootPath, '.claude');
					const settingsPath = pathMod.join(claudeDir, 'settings.json');
					fs.mkdirSync(claudeDir, { recursive: true });

					let existing: Record<string, unknown> = {};
					if (fs.existsSync(settingsPath)) {
						try {
							existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
						} catch { existing = {}; }
					}
					existing.hooks = hookConfig.hooks;
					fs.writeFileSync(settingsPath, JSON.stringify(existing, null, '\t') + '\n', 'utf8');

					vscode.window.showInformationMessage(
						`✅ Claude Code hooks installed! Config → ${settingsPath}`,
						'Open Settings'
					).then(sel => {
						if (sel === 'Open Settings') {
							vscode.workspace.openTextDocument(vscode.Uri.file(settingsPath))
								.then(doc => vscode.window.showTextDocument(doc, { preview: false }));
						}
					});
					outputChannel.appendLine(`[ContextManager] Claude Code hooks installed to ${settingsPath}`);
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to install Claude Code hooks: ${err.message}`);
					console.error('[ContextManager] installClaudeCodeHooks failed:', err);
				}
			}),
			vscode.commands.registerCommand('contextManager.captureExchange', async () => {
				if (!autoCapture) {
					vscode.window.showWarningMessage('Auto-capture is not available.');
					return;
				}
				const prompt = await vscode.window.showInputBox({
					title: 'Capture Chat Exchange (1/2)',
					prompt: 'What did you ask Copilot?',
					placeHolder: 'e.g., How does the authentication flow work?',
					ignoreFocusOut: true,
				});
				if (!prompt?.trim()) { return; }

				const response = await vscode.window.showInputBox({
					title: 'Capture Chat Exchange (2/2)',
					prompt: 'Summarize what Copilot helped you with',
					placeHolder: 'e.g., Explained JWT validation in middleware.ts, showed token refresh pattern',
					ignoreFocusOut: true,
				});
				if (!response?.trim()) { return; }

				try {
					await autoCapture.onModelResponse(prompt.trim(), response.trim(), 'manual');
					vscode.window.showInformationMessage('✅ Exchange captured.');
				} catch (err) {
					console.error('[ContextManager] captureExchange failed:', err);
					vscode.window.showErrorMessage('Failed to capture exchange.');
				}
			}),
			vscode.commands.registerCommand('contextManager.saveAsCard', async () => {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject) {
					vscode.window.showWarningMessage('No active project. Create or select a project first.');
					return;
				}

				// Get last chat exchange from background tasks
				const lastExchange = getLastChatExchange();
				if (!lastExchange.trim()) {
					vscode.window.showWarningMessage('No recent chat exchange found. Start a conversation first.');
					return;
				}

				// Parse assistant response from exchange
				// Format: "User (/cmd): ...\n\nAssistant: ..."
				const assistantMatch = lastExchange.match(/Assistant:\s*([\s\S]+)$/);
				if (!assistantMatch || !assistantMatch[1].trim()) {
					vscode.window.showWarningMessage('No assistant response found in last exchange.');
					return;
				}

				const responseContent = assistantMatch[1].trim();

				// Extract user question as default title
				const userMatch = lastExchange.match(/User \([^)]+\):\s*([^\n]+)/);
				const userQuestion = userMatch ? userMatch[1].trim() : 'Knowledge card from chat';
				const defaultTitle = userQuestion.length > 60 ? userQuestion.substring(0, 60) + '...' : userQuestion;

				// Prompt for title
				const title = await vscode.window.showInputBox({
					title: 'Save as Knowledge Card',
					prompt: 'Enter a concise title for the knowledge card',
					value: defaultTitle,
					placeHolder: 'Enter title',
				});

				if (!title?.trim()) {
					return; // User cancelled
				}

				// Prompt for category
				const categories: vscode.QuickPickItem[] = [
					{ label: 'explanation', description: 'How something works' },
					{ label: 'pattern', description: 'Code patterns, conventions', picked: true },
					{ label: 'architecture', description: 'System design, structure' },
					{ label: 'convention', description: 'Coding standards' },
					{ label: 'note', description: 'General notes' },
					{ label: 'other', description: 'Miscellaneous' },
				];

				const categoryPick = await vscode.window.showQuickPick(categories, {
					title: 'Select category',
					placeHolder: 'Choose a category for this card',
				});

				if (!categoryPick) {
					return; // User cancelled
				}

				try {
					const category = categoryPick.label as 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other';

					// ── Smart Merge Check ──────────────────────────────
					if (ConfigurationManager.smartMergeEnabled) {
						const candidateText = `${title.trim()} ${responseContent}`;
						const similar = projectManager.findSimilarKnowledgeCard(activeProject.id, candidateText, 0.5);
						if (similar) {
							const choice = await vscode.window.showInformationMessage(
								`Similar card found: "${similar.card.title}" (${Math.round(similar.similarity * 100)}% overlap). Merge new content into it?`,
								{ modal: true },
								'Merge', 'Create New'
							);

							if (!choice) { return; } // User cancelled (Esc)

							if (choice === 'Merge') {
								// Use LLM to blend new content into existing card
								let mergedContent = responseContent;
								try {
									const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
									const model = models[0];
									if (model) {
										const mergePrompt = `You are merging two knowledge card entries into one improved card.

Existing card: "${similar.card.title}"
${similar.card.content}

---

New content to merge in:
${responseContent.substring(0, 2000)}

---

Create a single merged knowledge card that:
- Preserves all unique information from both
- Removes duplication
- Keeps structure clear and readable
- Is more complete than either alone

Return ONLY the merged card content (no title, no JSON, just the text).`;
										const req = await model.sendRequest(
											[vscode.LanguageModelChatMessage.User(mergePrompt)],
											{},
											new vscode.CancellationTokenSource().token
										);
										let merged = '';
										for await (const chunk of req.text) { merged += chunk; }
										if (merged.trim()) { mergedContent = merged.trim(); }
									}
								} catch (llmErr) {
									console.warn('[ContextManager] LLM merge failed, appending instead:', llmErr);
									mergedContent = `${similar.card.content}\n\n---\n\n${responseContent}`;
								}

								await projectManager.updateKnowledgeCard(activeProject.id, similar.card.id, {
									content: mergedContent,
									source: 'Merged via saveAsCard command',
								});
								vscode.window.showInformationMessage(`✅ Merged into existing card "${similar.card.title}".`);
								return;
							}
							// else: 'Create New' — fall through to addKnowledgeCard below
						}
					}

					await projectManager.addKnowledgeCard(
						activeProject.id,
						title.trim(),
						responseContent,
						category,
						[],
						'Chat conversation (saved via command)',
					);
					vscode.window.showInformationMessage(`✅ Knowledge card "${title.trim()}" created successfully.`);
				} catch (err: any) {
					console.error('[ContextManager] saveAsCard failed:', err);
					vscode.window.showErrorMessage(`Failed to save knowledge card: ${err.message}`);
				}
			})
		);

		// Add projectManager to subscriptions for cleanup
		context.subscriptions.push(projectManager);
		context.subscriptions.push(cache);

		// Show welcome message for first-time users
		showWelcomeMessageIfNeeded(context, projectManager);

	} catch (error) {
		console.error('Failed to activate ContextManager:', error);
		vscode.window.showErrorMessage('ContextManager failed to activate. Please check the console for details.');
	}
}

export function deactivate() {
	console.log('ContextManager extension deactivated');
}

/**
 * Show a welcome message to first-time users with quick start options.
 */
async function showWelcomeMessageIfNeeded(context: vscode.ExtensionContext, projectManager: ProjectManager) {
	const hasShownWelcome = context.globalState.get<boolean>('contextManager.hasShownWelcome', false);
	
	if (!hasShownWelcome && projectManager.getAllProjects().length === 0) {
		const result = await vscode.window.showInformationMessage(
			'Welcome to ContextManager! Get started by creating your first project to organize knowledge cards, TODOs, and AI explanations.',
			'Create Project',
			'Open Dashboard',
			'Don\'t Show Again'
		);

		if (result === 'Create Project') {
			vscode.commands.executeCommand('contextManager.createProject');
		} else if (result === 'Open Dashboard') {
			vscode.commands.executeCommand('contextManager.openDashboard');
		}

		await context.globalState.update('contextManager.hasShownWelcome', true);
	}
}

/**
 * Migrate data from an alternate publisher's globalStorage directory.
 * Handles the case where the extension was installed under a different publisher
 * (e.g. local-dev vs HarshaNarayanaP) and data lives in the old location.
 */
function migrateFromAlternatePublisher(context: vscode.ExtensionContext): void {
	const fs = require('fs') as typeof import('fs');
	const pathMod = require('path') as typeof import('path');

	try {
		const currentDir = context.globalStorageUri.fsPath;
		const parentDir = pathMod.dirname(currentDir);
		const extensionName = 'context-manager';
		const knownPublishers = ['harshananarayanap', 'local-dev'];

		// Check if current storage already has projects.json — if so, no migration needed
		if (fs.existsSync(pathMod.join(currentDir, 'projects.json'))) {
			return;
		}

		// Search for data in alternate publisher directories
		for (const pub of knownPublishers) {
			const altDir = pathMod.join(parentDir, `${pub}.${extensionName}`);
			if (altDir === currentDir) { continue; }
			if (!fs.existsSync(pathMod.join(altDir, 'projects.json'))) { continue; }

			// Found data in an alternate location — copy all files
			outputChannel.appendLine(`[ContextManager] Migrating data from ${altDir}`);
			fs.mkdirSync(currentDir, { recursive: true });

			const files = fs.readdirSync(altDir);
			let copied = 0;
			for (const file of files) {
				const src = pathMod.join(altDir, file);
				const dest = pathMod.join(currentDir, file);
				try {
					const stat = fs.statSync(src);
					if (stat.isFile()) {
						fs.copyFileSync(src, dest);
						copied++;
					}
				} catch { /* skip individual file errors */ }
			}
			outputChannel.appendLine(`[ContextManager] Migrated ${copied} files from ${pub} publisher storage`);
			return; // Done — use the first source found
		}
	} catch (err) {
		console.error('[ContextManager] Cross-publisher migration failed:', err);
		// Non-fatal — extension continues normally
	}
}
