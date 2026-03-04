/**
 * Dashboard webview panel for viewing projects, cache, and knowledge cards.
 */

import * as vscode from 'vscode';
import { handleWebviewMessage, DashboardContext } from './messageHandler';
import { getDashboardStyles } from './styles';
import { getDashboardScript } from './webviewScript';
import { escapeHtml, formatAge, formatDuration, getNonce, renderMarkdown } from './htmlHelpers';
import { renderCardTile, renderKnowledgeSubtabs, renderMultiSelectBar, renderEditorPanel, renderToolCallViewer, renderWorkbenchFilterBar, renderWorkbenchStagingArea } from './cardCanvas';
import { ProjectManager } from '../projects/ProjectManager';
import { ExplanationCache, CacheEntry } from '../cache';
import { Project } from '../projects/types';
import { ConfigurationManager } from '../config';
import type { AutoCaptureService } from '../autoCapture';
import type { HookWatcher } from '../hooks/HookWatcher';

export class DashboardPanel {
	public static currentPanel: DashboardPanel | undefined;
	private static readonly viewType = 'contextManagerDashboard';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];
	private _suppressUpdate = false;
	private _pendingUpdate = false;
	private _updateTimer: ReturnType<typeof setTimeout> | undefined;
	private _suppressTimer: ReturnType<typeof setTimeout> | undefined;
	private static readonly MAX_SUPPRESS_MS = 5000;

	// Host-side active tab — survives full HTML re-renders; updated via webview message
	private _currentTab: string = 'intelligence';
	// Cached model families from vscode.lm API — populated async on first render
	private _availableModelFamilies: string[] = [];
	// Card IDs with stale file references (anchors/referenceFiles modified since card.updated)
	private _staleCardIds: Set<string> = new Set();


	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		private projectManager: ProjectManager,
		private cache: ExplanationCache,
		private initialProjectId?: string,
		private initialTab?: string,
		private autoCapture?: AutoCaptureService,
		private hookWatcher?: HookWatcher,
	) {
		this._panel = panel;
		this._extensionUri = extensionUri;

		// Render immediately
		this._flushUpdate();

		// Query available models async, then re-render to populate dropdowns
		vscode.lm.selectChatModels({}).then(models => {
			const families = [...new Set(models.map(m => m.family))].sort();
			if (families.length && JSON.stringify(families) !== JSON.stringify(this._availableModelFamilies)) {
				this._availableModelFamilies = families;
				this._flushUpdate();
			}
		}, () => { /* ignore errors — dropdown stays with current value only */ });

		// Refresh working note staleness + card file staleness for active project
		const active = projectManager.getActiveProject();
		if (active) {
			projectManager.refreshStaleness(active.id).then(changed => {
				if (changed) { this._flushUpdate(); }
			}, () => {});
			this._refreshCardStaleness(active.id);
		}

		// Listen for when the panel is disposed
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update when project data changes
		projectManager.onDidChangeProjects(() => this._guardedUpdate(), null, this._disposables);
		projectManager.onDidChangeActiveProject(() => this._guardedUpdate(), null, this._disposables);

		// Auto-release suppression when user switches away from the dashboard.
		// Forms/editors remain "visible" in the hidden webview DOM, which prevents the
		// webview-side focusout handler from releasing suppression. When the user comes
		// back, _endSuppression flushes any queued updates (e.g. new queue items).
		this._panel.onDidChangeViewState(() => {
			if (!this._panel.active && this._suppressUpdate) {
				this._endSuppression();
			}
		}, null, this._disposables);

		// Refresh stalenesson file save (debounced — only if dashboard is open)
		let stalenessTimer: ReturnType<typeof setTimeout> | undefined;
		vscode.workspace.onDidSaveTextDocument(() => {
			if (stalenessTimer) { clearTimeout(stalenessTimer); }
			stalenessTimer = setTimeout(() => {
				const proj = projectManager.getActiveProject();
				if (proj) {
					projectManager.refreshStaleness(proj.id).then(changed => {
						if (changed) { this._flushUpdate(); }
					}, () => {});
					this._refreshCardStaleness(proj.id);
				}
			}, 2000);
		}, null, this._disposables);

		// Handle messages from the webview
		const ctx: DashboardContext = {
			projectManager,
			cache,
			autoCapture: this.autoCapture,
			hookWatcher: this.hookWatcher,
			postMessage: (msg: any) => this._panel.webview.postMessage(msg),
			update: () => this._update(),
			setSuppressUpdate: (v: boolean) => { this._setSuppressUpdate(v); },
			endSuppression: () => this._endSuppression(),
		};
		this._panel.webview.onDidReceiveMessage(
			(message) => {
				// Intercept tab-tracking message before the security allowlist.
				// This keeps host-side tab state in sync so every re-render restores
				// the correct tab even if vscode.getState() is unavailable.
				if (message.command === 'setCurrentTab' && typeof message.tab === 'string') {
					this._currentTab = message.tab;
					return;
				}
				handleWebviewMessage(message, ctx);
			},
			null,
			this._disposables
		);
	}

	public static createOrShow(
		extensionUri: vscode.Uri,
		projectManager: ProjectManager,
		cache: ExplanationCache,
		projectId?: string,
		tab?: string,
		autoCapture?: AutoCaptureService,
		hookWatcher?: HookWatcher,
	) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If panel already exists, show it and refresh content
		if (DashboardPanel.currentPanel) {
			DashboardPanel.currentPanel._panel.reveal(column);
			DashboardPanel.currentPanel._flushUpdate();
			return;
		}

		// Create new panel
		const panel = vscode.window.createWebviewPanel(
			DashboardPanel.viewType,
			'ContextManager Dashboard',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri]
			}
		);

		DashboardPanel.currentPanel = new DashboardPanel(
			panel,
			extensionUri,
			projectManager,
			cache,
			projectId,
			tab,
			autoCapture,
			hookWatcher
		);
	}

	public dispose() {
		DashboardPanel.currentPanel = undefined;

		if (this._updateTimer) {
			clearTimeout(this._updateTimer);
		}
		if (this._suppressTimer) {
			clearTimeout(this._suppressTimer);
		}

		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	/**
	 * Update only if not suppressed (e.g. during active editing in the webview).
	 * When suppressed, queue a pending update that fires when suppression ends.
	 */
	private _guardedUpdate() {
		if (!this._suppressUpdate) {
			this._update();
		} else {
			this._pendingUpdate = true;
		}
	}

	/**
	 * Set or clear suppression. When suppressing, start a safety timer that
	 * auto-releases after MAX_SUPPRESS_MS to avoid permanently stuck state.
	 */
	private _setSuppressUpdate(value: boolean) {
		this._suppressUpdate = value;
		if (value) {
			if (this._suppressTimer) { clearTimeout(this._suppressTimer); }
			this._suppressTimer = setTimeout(() => {
				if (this._suppressUpdate) {
					console.log('[DashboardPanel] Auto-releasing stale suppression after timeout');
					this._endSuppression();
				}
			}, DashboardPanel.MAX_SUPPRESS_MS);
		} else {
			if (this._suppressTimer) { clearTimeout(this._suppressTimer); this._suppressTimer = undefined; }
		}
	}

	/**
	 * End suppression and flush any queued update.
	 */
	private _endSuppression() {
		this._suppressUpdate = false;
		if (this._suppressTimer) { clearTimeout(this._suppressTimer); this._suppressTimer = undefined; }
		if (this._pendingUpdate) {
			this._pendingUpdate = false;
			this._update();
		}
	}

	/**
	 * Debounced update — coalesces rapid-fire re-renders (e.g. multiple toggle
	 * events, or event + explicit ctx.update()) into a single DOM replacement.
	 */
	private _update() {
		if (this._updateTimer) {
			clearTimeout(this._updateTimer);
		}
		this._updateTimer = setTimeout(() => {
			this._updateTimer = undefined;
			if (this._suppressUpdate) {
				this._pendingUpdate = true;
				return;
			}
			this._flushUpdate();
		}, 120);
	}

	/** Immediate (non-debounced) render. */
	private _flushUpdate() {
		const webview = this._panel.webview;
		this._panel.title = 'ContextManager Dashboard';
		this._panel.webview.html = this._getHtmlForWebview(webview);
	}

	/** Check card anchors/referenceFiles mtimes against card.updated — populate _staleCardIds. */
	private async _refreshCardStaleness(projectId: string): Promise<void> {
		if (!ConfigurationManager.intelligenceEnableStalenessTracking) { return; }
		const cards = this.projectManager.getKnowledgeCards(projectId);
		if (cards.length === 0) { return; }
		const project = this.projectManager.getProject(projectId);
		const roots = project?.rootPaths || [];

		// Collect all unique file paths from anchors + referenceFiles
		const fileSet = new Set<string>();
		for (const card of cards) {
			for (const a of card.anchors || []) { fileSet.add(a.filePath); }
			for (const f of card.referenceFiles || []) { fileSet.add(f); }
		}
		if (fileSet.size === 0) { return; }

		// Batch stat
		const mtimeCache = new Map<string, number>();
		await Promise.all([...fileSet].map(async (file) => {
			const candidates = file.match(/^[/\\]|^[a-zA-Z]:/) ? [file]
				: roots.map(r => vscode.Uri.joinPath(vscode.Uri.file(r), file));
			for (const candidate of candidates) {
				try {
					const uri = typeof candidate === 'string' ? vscode.Uri.file(candidate) : candidate;
					const stat = await vscode.workspace.fs.stat(uri);
					mtimeCache.set(file, stat.mtime);
					return;
				} catch { /* not found */ }
			}
		}));

		// Check each card
		const newStale = new Set<string>();
		for (const card of cards) {
			const files = [
				...(card.anchors || []).map(a => a.filePath),
				...(card.referenceFiles || []),
			];
			if (files.some(f => {
				const mtime = mtimeCache.get(f);
				return mtime !== undefined && mtime > card.updated;
			})) {
				newStale.add(card.id);
			}
		}

		// Only re-render if the set changed
		const changed = newStale.size !== this._staleCardIds.size ||
			[...newStale].some(id => !this._staleCardIds.has(id));
		if (changed) {
			this._staleCardIds = newStale;
			this._flushUpdate();
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const projects = this.projectManager.getAllProjects();
		const activeProject = this.projectManager.getActiveProject();
		const currentTab = this._currentTab || 'intelligence';
		
		const knowledgeFolders = activeProject?.knowledgeFolders || [];

		// Git data is loaded async via postMessage — not needed for initial render

		// Generate nonce for Content Security Policy
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<title>ContextManager Dashboard</title>
	${getDashboardStyles()}
</head>
<body>
	<div class="header">
		<h1>📚 ContextManager</h1>
		<select id="projectSelect" onchange="selectProject(this.value)">
			<option value="">Select Project...</option>
			${projects.map(p => `
				<option value="${p.id}" ${activeProject?.id === p.id ? 'selected' : ''}>
					${p.name}
				</option>
			`).join('')}
		</select>
		<button onclick="showNewProjectForm()">+ New Project</button>
		<span style="opacity: 0.5; font-size: 0.78em; margin-left: auto;" title="Ctrl+K: Search | 1-4: Switch tabs | Ctrl+N: New card">⌨️ Shortcuts: Ctrl+K search · 1-4 tabs · Ctrl+N new card</span>
	</div>

	<div class="tabs" role="tablist" aria-label="Dashboard tabs">
		<div class="tab${currentTab === 'intelligence' ? ' active' : ''}" id="tabBtn-intelligence" data-tab="intelligence" onclick="switchTab('intelligence')" role="tab" aria-selected="${currentTab === 'intelligence'}" aria-controls="tab-intelligence" tabindex="${currentTab === 'intelligence' ? '0' : '-1'}">🧠 Intelligence</div>
		<div class="tab${currentTab === 'knowledge' ? ' active' : ''}"id="tabBtn-knowledge" data-tab="knowledge" onclick="switchTab('knowledge')" role="tab" aria-selected="${currentTab === 'knowledge'}" aria-controls="tab-knowledge" tabindex="${currentTab === 'knowledge' ? '0' : '-1'}">Knowledge (${activeProject?.knowledgeCards?.length || 0})</div>
		<div class="tab${currentTab === 'context' ? ' active' : ''}" id="tabBtn-context"data-tab="context" onclick="switchTab('context')" role="tab" aria-selected="${currentTab === 'context'}" aria-controls="tab-context" tabindex="${currentTab === 'context' ? '0' : '-1'}">Context</div>
		<div class="tab${currentTab === 'settings' ? ' active' : ''}" id="tabBtn-settings" data-tab="settings" onclick="switchTab('settings')" role="tab" aria-selected="${currentTab === 'settings'}" aria-controls="tab-settings" tabindex="${currentTab === 'settings' ? '0' : '-1'}">⚙ Settings</div>
	</div>

	<!-- Intelligence Tab — Orchestrate Auto-Learn & Auto-Capture -->
	<div id="tab-intelligence" class="tab-content" role="tabpanel" aria-labelledby="tabBtn-intelligence"${currentTab !== 'intelligence' ? ' style="display: none;"' : ''}>
		${(() => {
			const cfg = vscode.workspace.getConfiguration('contextManager');
			if (!activeProject) {
				return `<div class="empty-state"><h2>No project selected</h2><p>Select a project to manage intelligence settings.</p></div>`;
			}
			const captureEnabled = cfg.get('autoCapture.enabled', true) as boolean;
			const learnEnabled = cfg.get('intelligence.autoLearn', true) as boolean;
			const allObs = this.autoCapture ? this.autoCapture.getRecentObservations(90 * 24 * 60 * 60 * 1000, activeProject.id) : [];
			const recent24 = this.autoCapture ? this.autoCapture.getRecentObservations(24 * 60 * 60 * 1000, activeProject.id) : [];
			return `
		<!-- Control Cards -->
		<div class="grid" style="grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 0;">
			<!-- Auto-Capture Card -->
			<div class="card" style="background: ${captureEnabled ? 'var(--vscode-testing-iconPassed)08' : ''}; border: 1px solid ${captureEnabled ? 'var(--vscode-testing-iconPassed)40' : 'var(--vscode-widget-border)'};">
				<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
					<h3 style="margin: 0;">📸 Auto-Capture</h3>
					<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
						<input type="checkbox" ${captureEnabled ? 'checked' : ''} onchange="updateSetting('autoCapture.enabled', this.checked)" style="width: 16px; height: 16px;">
						<strong style="font-size: 0.9em;">${captureEnabled ? 'ON' : 'OFF'}</strong>
					</label>
				</div>
				<p style="margin: 0 0 10px 0; opacity: 0.75; font-size: 0.88em;">Records interactions from all chat participants into a searchable, typed observation feed.</p>
				<p style="margin: 0 0 10px 0; font-size: 0.88em;"><strong>${allObs.length}</strong> total · <strong>${recent24.length}</strong> in last 24h</p>
				<label class="setting-row" style="margin-bottom: 6px;">
					<div class="setting-info"><strong>Learn from all chats</strong><div class="setting-desc">Run LLM extraction on all chat participants</div></div>
					<input type="checkbox" ${cfg.get('autoCapture.learnFromAllParticipants', true) ? 'checked' : ''} onchange="updateSetting('autoCapture.learnFromAllParticipants', this.checked)">
				</label>
				<div class="setting-row">
					<div class="setting-info"><strong>Buffer size</strong><div class="setting-desc">Max observations kept (circular, 10–200)</div></div>
					<input type="number" min="10" max="200" value="${cfg.get('autoCapture.maxObservations', 50)}" style="width: 60px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 4px 6px;" onchange="updateSetting('autoCapture.maxObservations', parseInt(this.value) || 50)">
				</div>
			</div>

			<!-- Auto-Learn Card -->
			<div class="card" style="background: ${learnEnabled ? 'var(--vscode-testing-iconPassed)08' : ''}; border: 1px solid ${learnEnabled ? 'var(--vscode-testing-iconPassed)40' : 'var(--vscode-widget-border)'};">
				<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
					<h3 style="margin: 0;">🧠 Auto-Learn</h3>
					<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
						<input type="checkbox" ${learnEnabled ? 'checked' : ''} onchange="updateSetting('intelligence.autoLearn', this.checked)" style="width: 16px; height: 16px;">
						<strong style="font-size: 0.9em;">${learnEnabled ? 'ON' : 'OFF'}</strong>
					</label>
				</div>
				<p style="margin: 0 0 10px 0; opacity: 0.75; font-size: 0.88em;">Extracts conventions, tool hints &amp; working notes from every interaction in the background.</p>
				<p style="margin: 0 0 10px 0; font-size: 0.88em;"><strong>${activeProject.conventions?.length || 0}</strong> conventions · <strong>${activeProject.toolHints?.length || 0}</strong> tool hints · <strong>${(activeProject as any).workingNotes?.length || 0}</strong> working notes</p>
				<label class="setting-row" style="margin-bottom: 6px;">
					<div class="setting-info"><strong>Use LLM</strong><div class="setting-desc">Higher-precision via lightweight LLM call</div></div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.useLLM', true) ? 'checked' : ''} onchange="updateSetting('intelligence.autoLearn.useLLM', this.checked)">
				</label>
				<label class="setting-row" style="margin-bottom: 10px;">
					<div class="setting-info"><strong>Show notifications</strong><div class="setting-desc">Toast when new learnings are extracted</div></div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.showInChat', true) ? 'checked' : ''} onchange="updateSetting('intelligence.autoLearn.showInChat', this.checked)">
				</label>
				<div style="display: flex; gap: 6px; flex-wrap: wrap;">
					<button onclick="vscode.postMessage({command:'distillObservations',maxObs:40})" style="font-size: 0.82em; padding: 3px 12px;" title="Use AI to extract conventions, tool hints, and working notes from observations">🤖 Distill Observations</button>
					<button class="secondary" onclick="switchTab('context')" style="font-size: 0.82em; padding: 3px 10px;" title="Review and curate auto-learned items">📋 Review Learnings</button>
				</div>
			</div>
		</div>
		`;
		})()}
		${(() => {
			// ─── Custom Workflows Section ─────────────────────────────────
			const activeProject = this.projectManager.getActiveProject();
			if (!activeProject) { return ''; }
			const workflows = activeProject.workflows || [];
			const cards = activeProject.knowledgeCards || [];

			// Card options for target selector
			const cardOptions = cards.map(c =>
				`<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`
			).join('');

			return `
		<div class="card" style="margin-top: 0;">
			<details${workflows.length > 0 ? ' open' : ''}>
			<summary style="cursor: pointer; user-select: none;">
				<h3 style="display: inline; margin: 0;">⚡ Custom Workflows (${workflows.length})</h3>
				<span style="opacity: 0.6; font-size: 0.82em; margin-left: 8px;">User-defined AI pipelines</span>
			</summary>
			<p style="opacity: 0.6; font-size: 0.85em; margin: 8px 0 12px 0;">
				Create AI workflows that fire automatically on new queue items or run manually. Use <code>{{queue.response}}</code>, <code>{{card.content}}</code>, <code>{{project.name}}</code> and more in your prompt template.
			</p>

			<!-- Existing workflows list -->
			${workflows.length > 0 ? `
			<div class="workflow-list" style="margin-bottom: 12px;">
				${workflows.map(wf => {
					const triggerBadge = wf.trigger === 'auto-queue' ? '<span class="wf-badge wf-badge-auto">auto</span>'
						: wf.trigger === 'both' ? '<span class="wf-badge wf-badge-both">auto+manual</span>'
						: '<span class="wf-badge wf-badge-manual">manual</span>';
					const outputBadge = wf.outputAction === 'create-card' ? '📄 create'
						: wf.outputAction === 'update-card' ? '✏️ update'
						: '📎 append';
					const statusIcon = !wf.lastRun ? '' : wf.lastRunStatus === 'success' ? '✅' : '❌';
					const lastRunInfo = wf.lastRun ? `Last: ${formatAge(wf.lastRun)} ${statusIcon}` : 'Never run';
					const targetName = wf.targetCardId ? (cards.find(c => c.id === wf.targetCardId)?.title || 'Unknown card') : '';
					return `
				<div class="workflow-item${!wf.enabled ? ' workflow-disabled' : ''}" data-workflow-id="${wf.id}" data-wf-name="${escapeHtml(wf.name)}" data-wf-prompt="${escapeHtml(wf.promptTemplate)}" data-wf-trigger="${wf.trigger}" data-wf-output="${wf.outputAction}" data-wf-target="${wf.targetCardId || ''}">
					<div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
						<label style="display:flex;align-items:center;gap:4px;cursor:pointer;flex-shrink:0;">
							<input type="checkbox" ${wf.enabled ? 'checked' : ''} onchange="toggleWorkflow('${wf.id}', this.checked)">
						</label>
						<strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(wf.name)}</strong>
						${triggerBadge}
						<span style="opacity:0.6;font-size:0.82em;flex-shrink:0;">${outputBadge}${targetName ? ` → ${escapeHtml(targetName)}` : ''}</span>
					</div>
					<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
						<span style="opacity:0.5;font-size:0.78em;">${lastRunInfo} · ${wf.runCount || 0} runs</span>
						<button onclick="runWorkflow('${wf.id}')" title="Run now" style="font-size:0.8em;padding:2px 8px;">▶</button>
						<button onclick="editWorkflow('${wf.id}')" title="Edit" style="font-size:0.8em;padding:2px 8px;">✏️</button>
						<button onclick="deleteWorkflow('${wf.id}')" title="Delete" style="font-size:0.8em;padding:2px 8px;opacity:0.6;">🗑</button>
					</div>
				</div>`;
				}).join('')}
			</div>` : ''}

			<button onclick="showAddWorkflowForm()" id="btn-add-workflow" style="font-size:0.85em; padding:4px 14px;">+ New Workflow</button>

			<!-- Add/Edit Workflow Form (hidden by default) -->
			<div id="workflow-form" style="display:none; margin-top:12px; padding:12px; background:var(--vscode-editor-background); border:1px solid var(--vscode-widget-border); border-radius:6px;">
				<input type="hidden" id="wf-edit-id" value="">
				<div class="form-group" style="margin-bottom:8px;">
					<label style="font-weight:600;font-size:0.85em;">Name</label>
					<input type="text" id="wf-name" placeholder="e.g. Track Files Touched" style="width:100%;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;">
				</div>
				<div class="form-group" style="margin-bottom:8px;">
					<label style="font-weight:600;font-size:0.85em;">Prompt Template</label>
					<textarea id="wf-prompt" rows="5" placeholder="Extract all file paths from this response:\\n{{queue.response}}" style="width:100%;padding:6px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;resize:vertical;font-family:var(--vscode-editor-font-family);font-size:0.9em;"></textarea>
					<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
						<span style="opacity:0.5;font-size:0.75em;">Insert:</span>
						${['queue.prompt','queue.response','queue.participant','queue.toolCalls','card.title','card.content','card.tags','project.name','project.conventions','project.description'].map(v =>
							`<button type="button" class="wf-var-btn" onclick="insertWfVar('${v}')" style="font-size:0.72em;padding:1px 6px;border-radius:3px;opacity:0.8;cursor:pointer;">{{${v}}}</button>`
						).join('')}
					</div>
				</div>
				<div style="display:flex;gap:12px;margin-bottom:8px;">
					<div class="form-group" style="flex:1;">
						<label style="font-weight:600;font-size:0.85em;">Trigger</label>
						<select id="wf-trigger" style="width:100%;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;">
							<option value="manual">Manual only</option>
							<option value="auto-queue">Auto (on queue add)</option>
							<option value="both">Both</option>
						</select>
					</div>
					<div class="form-group" style="flex:1;">
						<label style="font-weight:600;font-size:0.85em;">Output Action</label>
						<select id="wf-output" onchange="wfOutputChanged()" style="width:100%;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;">
							<option value="create-card">Create new card</option>
							<option value="update-card">Update existing card</option>
							<option value="append-collector">Append to collector card</option>
						</select>
					</div>
				</div>
				<div id="wf-target-row" class="form-group" style="margin-bottom:10px;display:none;">
					<label style="font-weight:600;font-size:0.85em;">Target Card</label>
					<select id="wf-target-card" style="width:100%;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;">
						<option value="">(select a card)</option>
						${cardOptions}
					</select>
				</div>
				<div style="display:flex;gap:8px;justify-content:flex-end;">
					<button class="secondary" onclick="hideWorkflowForm()">Cancel</button>
					<button onclick="saveWorkflow()">💾 Save Workflow</button>
				</div>
			</div>
			</details>
		</div>`;
		})()}
		${(() => {
			// Observation Feed
			if (!this.autoCapture) { return ''; }
			const activeProject = this.projectManager.getActiveProject();
			const projectId = activeProject?.id;
			const recent = this.autoCapture.getRecentObservations(24 * 60 * 60 * 1000, projectId);
			if (recent.length === 0) { return ''; }
			const { OBSERVATION_TYPE_EMOJI } = require('../autoCapture');
			const items = recent.slice(-50).reverse();
			// Type breakdown
			const typeCounts: Record<string, number> = {};
			for (const o of recent) {
				typeCounts[o.type] = (typeCounts[o.type] || 0) + 1;
			}
			const breakdown = Object.entries(typeCounts)
				.sort((a, b) => b[1] - a[1])
				.map(([type, count]) => `${OBSERVATION_TYPE_EMOJI[type] || '📝'} ${count} ${type}`)
				.join(' · ');
			// Source breakdown for filter pills
			const sources = [...new Set(items.map(o => o.participant))];
			return `
		<div class="card">
			<details open>
			<summary style="cursor: pointer; user-select: none;">
				<h3 style="display: inline; margin: 0;">📹 Recent Observations (${recent.length})</h3>
				<span style="opacity: 0.6; font-size: 0.82em; margin-left: 8px;">${breakdown}</span>
			</summary>
			<div style="margin-top: 10px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
				<span style="opacity:0.6; font-size:0.8em;">Filter:</span>
				<button class="pill pill-active" id="obs-pill-all" onclick="obsFilter('all')" style="font-size:0.78em; padding:2px 10px; border-radius:999px;">All (${recent.length})</button>
				${sources.map(src => `<span style="display:inline-flex;align-items:center;gap:2px;"><button class="pill" id="obs-pill-${escapeHtml(src)}" onclick="obsFilter('${escapeHtml(src)}')" style="font-size:0.78em; padding:2px 10px; border-radius:999px 0 0 999px; border-right:none;">${escapeHtml(src)}</button><button onclick="clearObsBySource('${escapeHtml(src)}')" title="Clear all ${escapeHtml(src)} observations" style="font-size:0.75em;padding:2px 6px;border-radius:0 999px 999px 0;opacity:0.7;" >🗑</button></span>`).join('')}
				<span style="flex:1"></span>
				<button onclick="vscode.postMessage({command:'distillObservations',maxObs:40})" style="font-size:0.8em; padding:3px 12px;" title="Use AI to extract conventions, tool hints, and working notes from observations">🤖 Distill with AI</button>
			</div>
			<div style="margin-top: 8px; max-height: 400px; overflow-y: auto;">
				<table id="obs-table" style="width: 100%; border-collapse: collapse; font-size: 0.88em;">
					<thead>
						<tr style="opacity: 0.7; border-bottom: 1px solid var(--vscode-widget-border);">
							<th style="text-align: left; padding: 4px 8px;">Time</th>
							<th style="text-align: left; padding: 4px 8px;">From</th>
							<th style="text-align: left; padding: 4px 8px;">Prompt</th>
							<th style="text-align: right; padding: 4px 8px;">Actions</th>
						</tr>
					</thead>
					<tbody>
						${items.map(o => {
							const age = formatAge(o.timestamp);
							const promptPreview = escapeHtml((o.prompt || '').substring(0, 100).replace(/\n+/g, ' '));
							return `<tr data-src="${escapeHtml(o.participant)}" style="border-bottom: 1px solid var(--vscode-widget-border)20;">
								<td style="padding: 6px 8px; white-space: nowrap; opacity: 0.7;">${age}</td>
								<td style="padding: 6px 8px; white-space: nowrap; opacity: 0.7;">${escapeHtml(o.participant || 'copilot')}</td>
								<td style="padding: 6px 8px;">${promptPreview}${(o.prompt || '').length > 100 ? '…' : ''}</td>
								<td style="padding: 6px 4px; white-space: nowrap; text-align: right;">
									<button title="Delete observation" onclick="deleteObs('${o.id}', this)" style="font-size:0.75em;padding:1px 5px;opacity:0.6;">✕</button>
								</td>
							</tr>`;
						}).join('')}
					</tbody>
				</table>
			</div>
			</details>
		</div>
		<!-- Distill Review Panel (inline, non-blocking) -->
		<div id="distill-modal" style="display:none; margin-top:16px;">
			<div class="card" style="border: 1px solid var(--vscode-focusBorder);">
				<div id="distill-loading" style="text-align:center; padding:20px 0;">🤖 Distilling observations with AI…</div>
				<div id="distill-content" style="display:none;">
					<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
						<h3 style="margin:0; flex-grow:1;">🤖 Distillation Results</h3>
						<button class="secondary" onclick="closeDistillModal()" style="padding:2px 10px; font-size:0.85em;">✕ Close</button>
					</div>
					<p style="opacity:0.6; font-size:0.85em; margin:0 0 16px 0;">Check the items you want to save. Uncheck to skip.</p>
					<div id="distill-error" style="color:var(--vscode-errorForeground); display:none; margin-bottom:12px;"></div>
					<div id="distill-sections"></div>
					<div style="margin-top:16px; display:flex; gap:8px; justify-content:flex-end;">
						<button class="secondary" onclick="closeDistillModal()">Cancel</button>
						<button onclick="saveDistillSelected()">💾 Save Selected</button>
					</div>
				</div>
			</div>
		</div>`;
		})()}
	</div>


	<div id="tab-knowledge"class="tab-content" role="tabpanel" aria-labelledby="tabBtn-knowledge"${currentTab !== 'knowledge' ? ' style="display: none;"' : ''}>
		${activeProject ? `
			${renderKnowledgeSubtabs(
				activeProject.knowledgeCards?.length || 0,
				activeProject.cardQueue?.length || 0,
				'workbench',
				(activeProject.conventions || []).length,
				(activeProject.workingNotes || []).length
			)}

			<!-- ─── Workbench Subtab ───────────────────────────────────────── -->
			<div id="subtab-workbench" class="knowledge-subtab-content">
				${renderWorkbenchFilterBar()}
				${renderMultiSelectBar(false)}
				<div class="card-tile-grid" id="workbench-tile-grid">
					${(activeProject.knowledgeCards || []).map(card =>
						renderCardTile(card, { kind: 'card', isSelected: false })
					).join('')}
					${(activeProject.cardQueue || []).map((candidate: any) =>
						renderCardTile(candidate, { kind: 'queue', isSelected: false })
					).join('')}
					${(activeProject.conventions || []).map((conv: any) =>
						renderCardTile(conv, { kind: 'convention', isSelected: false })
					).join('')}
					${(activeProject.workingNotes || []).map((note: any) =>
						renderCardTile(note, { kind: 'note', isSelected: false })
					).join('')}
					${(activeProject.toolHints || []).map((hint: any) =>
						renderCardTile(hint, { kind: 'hint', isSelected: false })
					).join('')}
				</div>
				${renderWorkbenchStagingArea()}
				${renderEditorPanel()}
			</div>

			<!-- ─── Knowledge Cards Subtab ──────────────────────────────────── -->
			<div id="subtab-cards" class="knowledge-subtab-content" style="display: none;">
			<div class="card">
				<div style="display: flex; align-items: center; margin-bottom: 16px;">
					<h3 style="flex-grow: 1; margin: 0;">
						Knowledge Cards
						<span style="font-weight: normal; font-size: 0.9em;">
							(${activeProject.selectedCardIds?.length || 0} selected)
						</span>
					</h3>
					${(activeProject.selectedCardIds?.length || 0) > 0 ? `<button class="secondary" onclick="uncheckAllCards()" style="margin-right: 8px;">Uncheck All</button>` : ''}
					<button onclick="generateCardWithAI()">🤖 Generate with AI</button>
					<button onclick="showAddCardForm()" style="margin-left: 8px;">+ Add Card</button>
				</div>
				<p style="opacity: 0.7; margin-bottom: 16px;">
					Selected cards are included as context in all AI prompts for this project.
				</p>

				<!-- Search & Filter Bar — always on top -->
				<div class="search-filter-bar" style="margin-bottom: 16px;">
					<input type="text" class="search-input" placeholder="🔍 Search knowledge cards..." oninput="searchKnowledgeCards(this.value)">
					<select class="filter-select" onchange="filterKnowledgeCards(this.value)">
						<option value="all">All Categories</option>
						<option value="architecture">Architecture</option>
						<option value="pattern">Pattern</option>
						<option value="convention">Convention</option>
						<option value="explanation">Explanation</option>
						<option value="note">Note</option>
						<option value="other">Other</option>
					</select>
					<button class="secondary" onclick="addKnowledgeFolder()" style="white-space: nowrap;">📁 New Folder</button>
				</div>

				<div id="addCardForm" style="display: none; margin-bottom: 16px; padding: 12px; background: var(--bg-color); border-radius: 4px;">
					<div class="form-group">
						<label>Title</label>
						<input type="text" id="newCardTitle" placeholder="Card title">
					</div>
					<div class="form-group">
						<label>Category</label>
						<select id="newCardCategory">
							<option value="architecture">Architecture</option>
							<option value="pattern">Pattern</option>
							<option value="convention">Convention</option>
							<option value="explanation">Explanation</option>
							<option value="note" selected>Note</option>
							<option value="other">Other</option>
						</select>
					</div>
					<div class="form-group">
						<label>Folder</label>
						<select id="newCardFolder">
							<option value="">Root</option>
							${(() => {
								const rootKey = '__root__';
								const folderIds = new Set((knowledgeFolders || []).map(f => f.id));
								const children = new Map<string, typeof knowledgeFolders>();
								const pushChild = (key: string, folder: typeof knowledgeFolders[number]) => {
									if (!children.has(key)) { children.set(key, []); }
									children.get(key)!.push(folder);
								};
								for (const folder of knowledgeFolders) {
									const parent = folder.parentFolderId && folderIds.has(folder.parentFolderId) ? folder.parentFolderId : rootKey;
									pushChild(parent, folder);
								}
								for (const [, arr] of children) {
									arr.sort((a, b) => a.name.localeCompare(b.name));
								}
								const renderOptions = (parentId: string, depth: number): string => {
									return (children.get(parentId) || []).map(folder =>
										`<option value="${folder.id}">${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${escapeHtml(folder.name)}</option>${renderOptions(folder.id, depth + 1)}`
									).join('');
								};
								return renderOptions(rootKey, 0);
							})()}
						</select>
					</div>
					<div class="form-group">
						<label>Content</label>
						<textarea id="newCardContent" placeholder="The knowledge/context to remember..." style="min-height: 120px;"></textarea>
					</div>
					<div class="form-group" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
						<label style="display: inline-flex; align-items: center; gap: 8px; margin: 0;">
							<input type="checkbox" id="newCardTrackTools">
							<span>Track successful tools for this card</span>
						</label>
						<button class="secondary" onclick="applyCardTemplate()" type="button">Use template</button>
					</div>
					<button onclick="addCard()">Add Card</button>
					<button class="secondary" onclick="hideAddCardForm()">Cancel</button>
				</div>
				${(activeProject.knowledgeCards?.length || 0) > 0 ? (() => {
					const rootKey = '__root__';
					const folders = knowledgeFolders || [];
					const folderIds = new Set(folders.map(f => f.id));
					const folderById = new Map(folders.map(f => [f.id, f]));
					const folderChildren = new Map<string, typeof folders>();
					const pushChild = (key: string, folder: typeof folders[number]) => {
						if (!folderChildren.has(key)) { folderChildren.set(key, []); }
						folderChildren.get(key)!.push(folder);
					};
					for (const folder of folders) {
						const parent = folder.parentFolderId && folderIds.has(folder.parentFolderId) ? folder.parentFolderId : rootKey;
						pushChild(parent, folder);
					}
					for (const [, arr] of folderChildren) {
						arr.sort((a, b) => a.name.localeCompare(b.name));
					}

					const getFolderPath = (folderId?: string): string => {
						if (!folderId) { return 'Root'; }
						const names: string[] = [];
						let current = folderById.get(folderId);
						while (current) {
							names.unshift(current.name);
							if (!current.parentFolderId || !folderById.has(current.parentFolderId)) {
								break;
							}
							current = folderById.get(current.parentFolderId);
						}
						return names.join(' / ') || 'Root';
					};

					const orderedFolders: Array<{ id: string; label: string; depth: number }> = [];
					const collectFolders = (parentId: string, depth: number): void => {
						for (const folder of folderChildren.get(parentId) || []) {
							orderedFolders.push({ id: folder.id, label: folder.name, depth });
							collectFolders(folder.id, depth + 1);
						}
					};
					collectFolders(rootKey, 0);

					// Build folder→cards mapping
					const cardsByFolder = new Map<string, typeof cards>();
					const cards = [...(activeProject.knowledgeCards || [])];
					cards.sort((a, b) => a.title.localeCompare(b.title));
					for (const card of cards) {
						const key = card.folderId && folderIds.has(card.folderId) ? card.folderId : rootKey;
						if (!cardsByFolder.has(key)) { cardsByFolder.set(key, []); }
						cardsByFolder.get(key)!.push(card);
					}

					// Recursive tree renderer: folder header with hover actions → cards → subfolders
					const renderFolderTree = (parentId: string, depth: number): string => {
						const subFolders = folderChildren.get(parentId) || [];
						const folderCards = cardsByFolder.get(parentId) || [];
						const isRoot = parentId === rootKey;

						// Render folder section
						const parts: string[] = [];

						if (!isRoot || folderCards.length > 0 || subFolders.length === 0) {
							const folderLabel = isRoot ? 'Uncategorized' : (folderById.get(parentId)?.name || '');
							const cardCount = folderCards.length;
							const totalCount = cardCount + (subFolders.length > 0 ? subFolders.reduce((sum, sf) => sum + (cardsByFolder.get(sf.id)?.length || 0), 0) : 0);
							parts.push(`
								<details class="knowledge-tree-folder" data-expand-id="folder-${parentId}" data-folder-id="${parentId}" open style="margin-left: ${isRoot ? 0 : depth * 16}px; margin-top: ${depth === 0 ? 8 : 4}px;"
									ondragover="event.preventDefault(); this.classList.add('drag-over');"
									ondragleave="this.classList.remove('drag-over');"
									ondrop="event.preventDefault(); this.classList.remove('drag-over'); dropCardOnFolder(event, '${isRoot ? '' : parentId}');">
									<summary class="knowledge-tree-folder-header" style="cursor: pointer; list-style: none;">
										<span class="folder-toggle-arrow">▶</span>
										<span style="opacity: ${isRoot ? 0.6 : 0.85};">${isRoot ? '' : '📁 '}${escapeHtml(folderLabel)}</span>
										<span style="opacity: 0.5; font-size: 0.85em; margin-left: 4px;">${cardCount > 0 ? `(${cardCount})` : '(empty)'}</span>
										${!isRoot ? `<span class="knowledge-tree-folder-actions">
											<button class="secondary" style="padding: 1px 6px; font-size: 0.78em;" onclick="event.stopPropagation(); addKnowledgeSubfolder('${parentId}')">+ Sub</button>
											<button class="secondary" style="padding: 1px 6px; font-size: 0.78em;" onclick="event.stopPropagation(); renameKnowledgeFolder('${parentId}')">Rename</button>
											<button class="secondary" style="padding: 1px 6px; font-size: 0.78em; opacity: 0.7;" onclick="event.stopPropagation(); deleteKnowledgeFolder('${parentId}')">×</button>
										</span>` : ''}
									</summary>
							`);

							// Render cards inside this folder
							for (const card of folderCards) {
								const isSelected = (activeProject.selectedCardIds || []).includes(card.id);
								const escapedContent = escapeHtml(card.content).replace(/\x60/g, '&#96;').replace(/\$/g, '&#36;');
								const renderedContent = renderMarkdown(card.content);
								const topToolUsages = (card.toolUsages || [])
									.slice()
									.sort((a: any, b: any) => (b.successCount - a.successCount) || (b.lastUsed - a.lastUsed))
									.slice(0, 4);
								const folderMoveOptions = [
									`<option value="" ${!card.folderId ? 'selected' : ''}>Uncategorized</option>`,
									...orderedFolders.map(folder => `<option value="${folder.id}" ${card.folderId === folder.id ? 'selected' : ''}>${'  '.repeat(folder.depth)}${folder.depth > 0 ? '↳ ' : ''}${escapeHtml(folder.label)}</option>`),
								].join('');

								const staleAgeDays = ConfigurationManager.intelligenceStalenessAgeDays;
								const isAgeStale = (Date.now() - (card.updated || card.created || 0)) > staleAgeDays * 24 * 60 * 60 * 1000;
								const isFileStale = this._staleCardIds.has(card.id);
								const staleIcon = isFileStale
									? `<span title="File-stale: referenced files modified since last update" style="color: var(--vscode-warningForeground); margin-left: 4px;">⚠️</span>`
									: isAgeStale
										? `<span title="Age-stale: not updated in ${staleAgeDays}+ days" style="color: var(--vscode-warningForeground); margin-left: 4px; opacity: 0.7;">⏳</span>`
										: '';

								const cardBorderColor = isSelected ? 'var(--vscode-testing-iconPassed)' : card.pinned ? 'var(--vscode-charts-yellow, #e5c07b)' : 'transparent';
								const cardOpacity = card.archived ? 'opacity: 0.55;' : '';
								parts.push(`
								<details class="cache-item" data-expand-id="card-${card.id}" data-card-id="${card.id}" style="border-left: 3px solid ${cardBorderColor}; padding-left: 12px; margin-left: ${isRoot ? 0 : 8}px; ${cardOpacity}">
									<summary class="cache-header" draggable="true" ondragstart="dragCard(event, '${card.id}')" style="cursor: grab; list-style: none;">
										<span style="margin-right: 8px;">▶</span>
										<input type="checkbox"
											${isSelected ? 'checked' : ''}
											onchange="toggleCard('${card.id}')"
											onclick="event.stopPropagation()"
											title="Include in context">
										<span class="cache-symbol" title="${escapeHtml(card.content.split('\n').find((l: string) => l.trim())?.substring(0, 200) || '')}">${escapeHtml(card.title)}</span>
										<span class="cache-type">${card.category}</span>
										<span style="opacity: 0.5; font-size: 0.8em; margin-left: 6px;" title="Last updated: ${new Date(card.updated).toLocaleString()}">${formatAge(card.updated)}</span>${staleIcon}
										<span class="card-status-badges">${card.pinned ? '<span class="card-badge" title="Pinned">📌</span>' : ''}${card.trackToolUsage ? '<span class="card-badge" title="Tool tracking">🔧</span>' : ''}${card.includeInContext === false ? '<span class="card-badge card-badge-warn" title="Excluded from index">Hidden</span>' : ''}${card.archived ? '<span class="card-badge card-badge-warn" title="Archived">📦</span>' : ''}</span>
									</summary>
									<div style="margin-top: 12px; padding-left: 24px;">
										<div class="card-find-bar" id="card-find-${card.id}" style="display:none; margin-bottom: 6px; gap: 6px; align-items: center;">
											<input type="text" placeholder="Find in card…" oninput="findInCard('${card.id}', this.value)" style="flex: 1; padding: 4px 8px; font-size: 0.9em;">
											<button class="secondary" onclick="clearFindInCard('${card.id}')" style="padding: 4px 8px; font-size: 0.85em;">✕</button>
										</div>
										<div id="card-view-${card.id}" class="cache-explanation" style="background: var(--bg-color); padding: 12px; border-radius: 4px; max-height: 400px; overflow-y: auto; line-height: 1.5;">${renderedContent}</div>
										<div class="card-selection-hint" style="font-size: 0.78em; opacity: 0.45; margin-top: 4px; padding-left: 2px;">💡 Select text for more actions (replace, refine, create card…)</div>
										<div id="card-edit-${card.id}" class="inline-edit" style="display: none;">
											<div class="form-group" style="margin-bottom: 8px;">
												<label style="font-size: 0.85em; opacity: 0.7;">Title</label>
												<input type="text" id="card-title-editor-${card.id}" value="${escapeHtml(card.title)}" style="width: 100%; box-sizing: border-box;">
											</div>
											<div class="form-group" style="margin-bottom: 8px;">
												<label style="font-size: 0.85em; opacity: 0.7;">Content</label>
												<textarea id="card-editor-${card.id}" class="inline-edit-textarea">${escapedContent}</textarea>
											</div>
											<div class="form-group" style="margin-bottom: 8px;">
												<label style="display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-track-editor-${card.id}" ${card.trackToolUsage ? 'checked' : ''}>
													<span>Track successful tools for this card</span>
												</label>
											</div>
											<div class="form-group" style="margin-bottom: 8px; display: flex; gap: 16px; flex-wrap: wrap;">
												<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-pinned-editor-${card.id}" ${card.pinned ? 'checked' : ''}>
													<span>📌 Pinned</span>
												</label>
												<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-context-editor-${card.id}" ${card.includeInContext !== false ? 'checked' : ''}>
													<span>👁 Include in index</span>
												</label>
												<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-archived-editor-${card.id}" ${card.archived ? 'checked' : ''}>
													<span>🗃️ Archived</span>
												</label>
											</div>
											<div class="inline-edit-actions">
												<button onclick="saveCardEdit('${card.id}')">Save</button>
												<button class="secondary" onclick="cancelCardEdit('${card.id}')">Cancel</button>
											</div>
										</div>
										${card.trackToolUsage ? `<div style="margin-top: 10px; font-size: 0.85em; opacity: 0.9;">
											<strong>🔧 Tool memory:</strong>
											${topToolUsages.length > 0
												? `<ul style="margin: 6px 0 0 18px;">${topToolUsages.map((u: any) => `<li>${escapeHtml(u.toolName)} — ${escapeHtml(u.pattern)} (${u.successCount})</li>`).join('')}</ul>`
												: '<span style="opacity: 0.7;"> tracking enabled, no learned patterns yet.</span>'}
										</div>` : ''}
										<div class="card-flags-bar" style="margin-top: 12px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 10px; background: var(--bg-color); border-radius: 4px; font-size: 0.88em;">
											<span style="opacity: 0.6; margin-right: 4px;">Flags:</span>
											<button class="card-flag-btn ${card.pinned ? 'active' : ''}" onclick="setCardFlag('${card.id}', 'pinned', ${!card.pinned})" title="${card.pinned ? 'Unpin' : 'Pin — prioritize in index'}">📌 Pin</button>
											<button class="card-flag-btn ${card.trackToolUsage ? 'active' : ''}" onclick="toggleCardToolUsage('${card.id}', ${!card.trackToolUsage})" title="Track which tools work well with this card">🔧 Tools</button>
											<button class="card-flag-btn ${card.includeInContext !== false ? 'active' : ''}" onclick="setCardFlag('${card.id}', 'includeInContext', ${card.includeInContext === false})" title="${card.includeInContext === false ? 'Include in knowledge index' : 'Exclude from knowledge index'}">👁 Index</button>
											<button class="card-flag-btn ${card.archived ? 'active' : ''}" onclick="setCardFlag('${card.id}', 'archived', ${!card.archived})" title="${card.archived ? 'Restore from archive' : 'Archive — hide from index'}">🗃️ Archive</button>
										</div>
										<div class="cache-actions" style="margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
											<button class="secondary" onclick="editCard('${card.id}')">Edit</button>
											<button class="secondary" onclick="refineCardWithAI('${card.id}')">🔄 Refine with AI</button>
											<select onchange="moveCardToFolder('${card.id}', this.value)" style="max-width: 220px;">
												${folderMoveOptions}
											</select>
											<button class="secondary" onclick="deleteCard('${card.id}', this)">Delete</button>
										</div>
									</div>
								</details>`);
							}

							parts.push(`</details>`);
						}

						// Recurse into subfolders
						for (const sub of subFolders) {
							parts.push(renderFolderTree(sub.id, depth + 1));
						}

						return parts.join('');
					};

					return renderFolderTree(rootKey, 0);
				})() : `
					<div class="empty-state">
						<p>No knowledge cards yet.</p>
						<p>Add cards to save reusable context for this project.</p>
					</div>
				`}

				${activeProject && (activeProject.knowledgeCards?.length || 0) >= 2 ? (() => {
					const health = this.projectManager.getCardHealthAnalytics(activeProject.id);
					const issueCount = health.staleCards.length + health.duplicates.length + health.neverUsedCards.length;
					const hasIssues = issueCount > 0;
					if (!hasIssues && health.totalCards < 3) { return ''; }

					return `
					<details class="card" style="margin-top: 16px;" data-expand-id="card-health">
						<summary style="cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;">
							<span class="folder-toggle-arrow">\u25b6</span>
							<h3 style="margin: 0;">\ud83d\udcca Card Health</h3>
							${hasIssues ? `<span style="background: var(--vscode-warningForeground); color: #000; padding: 2px 8px; border-radius: 10px; font-size: 0.8em;">${issueCount} issue(s)</span>` : '<span style="opacity: 0.6; font-size: 0.85em;">All healthy</span>'}
						</summary>
						<div style="margin-top: 12px;">
							<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px;">
								<div style="text-align: center; padding: 10px; background: var(--bg-color); border-radius: 6px;">
									<div style="font-size: 1.4em; font-weight: bold;">${health.totalCards}</div>
									<div style="font-size: 0.8em; opacity: 0.7;">Total cards</div>
								</div>
								<div style="text-align: center; padding: 10px; background: var(--bg-color); border-radius: 6px;">
									<div style="font-size: 1.4em; font-weight: bold;">${health.selectedCards}</div>
									<div style="font-size: 0.8em; opacity: 0.7;">Selected</div>
								</div>
								<div style="text-align: center; padding: 10px; background: var(--bg-color); border-radius: 6px; ${health.staleCards.length > 0 ? 'border: 1px solid var(--vscode-warningForeground);' : ''}">
									<div style="font-size: 1.4em; font-weight: bold;">${health.staleCards.length}</div>
									<div style="font-size: 0.8em; opacity: 0.7;">Stale (30d+)</div>
								</div>
								<div style="text-align: center; padding: 10px; background: var(--bg-color); border-radius: 6px;">
									<div style="font-size: 1.4em; font-weight: bold;">${health.neverUsedCards.length}</div>
									<div style="font-size: 0.8em; opacity: 0.7;">Never used</div>
								</div>
							</div>

							${health.topUsedCards.length > 0 ? `
							<div style="margin-bottom: 12px;">
								<strong style="font-size: 0.9em;">\ud83c\udfc6 Most used cards</strong>
								<ul style="margin: 6px 0 0 18px; font-size: 0.85em;">
									${health.topUsedCards.map(c => `<li>${escapeHtml(c.title)} \u2014 <strong>${c.injectionCount || 0}</strong> injections, <strong>${c.selectionCount || 0}</strong> selections</li>`).join('')}
								</ul>
							</div>` : ''}

							${health.duplicates.length > 0 ? `
							<div style="margin-bottom: 12px;">
								<strong style="font-size: 0.9em;">\u26a0\ufe0f Possible duplicates</strong>
								<ul style="margin: 6px 0 0 18px; font-size: 0.85em; list-style: none; padding: 0;">
									${health.duplicates.slice(0, 5).map(d => `<li style="display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));">
										<span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;">"${escapeHtml(d.cardA.title)}" \u2194 "${escapeHtml(d.cardB.title)}" \u2014 ${(d.similarity * 100).toFixed(0)}% similar</span>
										<button onclick="mergeHealthDuplicates('${d.cardA.id}', '${d.cardB.id}')" title="Merge these two cards in the editor" style="flex-shrink: 0; padding: 2px 8px; font-size: 0.85em; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">\ud83d\udd17 Merge</button>
									</li>`).join('')}
								</ul>
								<p style="font-size: 0.8em; opacity: 0.7; margin-top: 4px;">Click Merge to combine a pair in the card editor.</p>
							</div>` : ''}

							${health.neverUsedCards.length > 0 ? `
							<div style="margin-bottom: 12px;">
								<strong style="font-size: 0.9em;">\ud83d\udca4 Never selected/injected</strong>
								<ul style="margin: 6px 0 0 18px; font-size: 0.85em;">
									${health.neverUsedCards.slice(0, 5).map(c => `<li>${escapeHtml(c.title)} [${c.category}] \u2014 created ${formatAge(c.created)}</li>`).join('')}
									${health.neverUsedCards.length > 5 ? `<li style="opacity: 0.6;">...and ${health.neverUsedCards.length - 5} more</li>` : ''}
								</ul>
							</div>` : ''}

							${health.staleCards.length > 0 ? `
							<div style="margin-bottom: 12px;">
								<strong style="font-size: 0.9em;">\ud83d\udd70\ufe0f Stale cards (not updated in 30+ days)</strong>
								<ul style="margin: 6px 0 0 18px; font-size: 0.85em;">
									${health.staleCards.slice(0, 5).map(c => `<li>${escapeHtml(c.title)} \u2014 last updated ${formatAge(c.updated)}</li>`).join('')}
									${health.staleCards.length > 5 ? `<li style="opacity: 0.6;">...and ${health.staleCards.length - 5} more</li>` : ''}
								</ul>
							</div>` : ''}
						</div>
					</details>`;
				})() : ''}

			</div>
			</div> <!-- /subtab-cards -->

			<!-- ─── Card Queue Subtab ──────────────────────────────────────── -->
			<div id="subtab-queue" class="knowledge-subtab-content" style="display: none;">
			<!-- ─── Card Queue (Canvas) ──────────────────────────────────────── -->
			<div class="card" style="margin-top: 16px;">
				<div style="display: flex; align-items: center; margin-bottom: 12px;">
					<h3 style="flex-grow: 1; margin: 0;">📬 Card Queue
						<span style="font-weight: normal; font-size: 0.9em; opacity: 0.7;">(${activeProject.cardQueue?.length || 0} pending)</span>
					</h3>
					${(activeProject.cardQueue?.length || 0) > 0 ? `
						<div style="display: flex; gap: 8px;">
							<button class="queue-distill-btn" title="Synthesize queued responses into knowledge cards using AI">🤖 Distill into Cards</button>
							<button class="secondary queue-clear-btn">Clear Queue</button>
						</div>
					` : ''}
				</div>
				${(activeProject.cardQueue?.length || 0) === 0
					? '<p style="opacity: 0.5; font-size: 0.88em;">Responses will be silently queued here — review and save as knowledge cards.</p>'
					: `
						${renderMultiSelectBar(true)}
						<div class="card-tile-grid" id="queue-tile-grid">
							${(activeProject.cardQueue || []).map((candidate: any) =>
								renderCardTile(candidate, { isQueue: true, isSelected: false })
							).join('')}
						</div>
					`
				}
				<div id="distill-queue-results" style="display:none; margin-bottom: 16px;"></div>
			</div>
			</div> <!-- /subtab-queue -->
		` : `
			<div class="empty-state">
				<p>Select a project first.</p>
			</div>
		`}
	</div>


	
	<div id="tab-context" class="tab-content" role="tabpanel" aria-labelledby="tabBtn-context"${currentTab !== 'context' ? ' style="display: none;"' : ''}>
		${activeProject ? `
			<div class="card">
				<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
					<h3 style="margin: 0; flex-grow: 1;">Project Context</h3>
				</div>
				<p style="opacity: 0.7; margin-bottom: 16px;">Included in AI prompts for this project via the chat helper.</p>
				
				<div class="form-group">
					<label>Goals</label>
					<textarea id="contextGoals" placeholder="What is this project about? What are you trying to achieve?">${activeProject.context.goals || ''}</textarea>
				</div>
				
				<div class="form-group">
					<label>Conventions</label>
					<textarea id="contextConventions" placeholder="Coding conventions, patterns, or rules to follow...">${activeProject.context.conventions || ''}</textarea>
				</div>
				
				<div class="form-group">
					<label>Key Files (one per line)</label>
					<textarea id="contextKeyFiles" placeholder="src/main.cc&#10;include/api.h">${activeProject.context.keyFiles.join('\n')}</textarea>
				</div>
				
				<div style="display: flex; align-items: center; gap: 12px; margin-top: 8px;">
					<span id="contextSaveStatus" style="font-size: 0.85em; opacity: 0.7;">Auto-saves on edit</span>
				</div>
			</div>

			<!-- Prompt Injection -->
			${(() => {
				const injection = activeProject.promptInjection;
				const selectedCount = (activeProject.selectedCardIds || []).length;
				const hasInjection = selectedCount > 0 || (injection?.customInstruction || '').trim();
				return `
			<div class="card" style="margin-top: 16px;">
				<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
					<h3 style="margin: 0; flex-grow: 1;">📌 Inject into Every Prompt</h3>
					${hasInjection ? `<span style="font-size: 0.72em; background: var(--vscode-testing-iconPassed, #28a745); color: #fff; padding: 2px 10px; border-radius: 10px; font-weight: 600; letter-spacing: 0.3px;">Active</span>` : ''}
				</div>
				<p style="opacity: 0.55; margin: 0 0 16px 0; font-size: 0.82em; line-height: 1.4;">
					Cards checked in the <strong>Knowledge</strong> tab above${selectedCount > 0 ? ` (${selectedCount} selected)` : ''} and your custom instruction are written to <code style="padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));">session-context.txt</code>
					and injected via the <strong>UserPromptSubmit</strong> hook on every prompt.
				</p>

				<div style="margin-bottom: 16px;">
					<label style="margin-bottom: 6px; display: block; font-size: 0.85em; font-weight: 600;">Custom Instruction <span style="opacity: 0.5; font-weight: normal;">(optional — prepended before cards)</span></label>
					<textarea id="injectionInstruction" rows="3" placeholder="e.g. Before starting, review these cards carefully and follow the patterns described."
						style="width: 100%; box-sizing: border-box; border-radius: 4px; padding: 8px 10px; font-size: 0.88em; resize: vertical;">${escapeHtml(injection?.customInstruction || '')}</textarea>
				</div>

				<div style="display: flex; gap: 8px; align-items: center;">
					<label style="display: flex; align-items: center; gap: 5px; font-size: 0.8em; cursor: pointer; opacity: 0.75; user-select: none;" title="When checked, full card content is included. Otherwise only titles are listed.">
						<input type="checkbox" id="injectionFullContent" ${injection?.includeFullContent ? 'checked' : ''}
							onchange="saveInjection()">
						Include full card content
					</label>
					<span style="flex-grow: 1;"></span>
					<button class="primary" onclick="saveInjection()">💾 Save</button>
					${hasInjection ? `<button class="secondary" onclick="clearInjection()">✕ Clear</button>` : ''}
				</div>
			</div>`;
			})()}

			<!-- Project Intelligence: Conventions -->
			${(() => {
				const conventions = activeProject.conventions || [];
				const disabledCount = conventions.filter(c => (c as any).enabled === false).length;
				return `
			<div class="card" style="margin-top: 16px;">
				<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
					<h3 style="margin: 0; flex-grow: 1;">🏗 Conventions${disabledCount > 0 ? ` <span style="opacity: 0.6; font-size: 0.8em; font-weight: normal;">(${disabledCount} disabled)</span>` : ''}</h3>
				</div>
				<p style="opacity: 0.7; margin-bottom: 12px; font-size: 0.9em;">
					Codebase conventions learned by the agent. All enabled conventions are injected into every prompt.<br/>
					<span style="font-size: 0.85em;">Toggle the switch to enable/disable individual conventions.</span>
				</p>
				${(() => {
					return conventions.length > 0 ? conventions.map(c => {
						const isEnabled = (c as any).enabled !== false;
						return `
						<div style="padding: 10px 12px; margin-bottom: 8px; border-radius: 6px; background: var(--vscode-editor-background); border-left: 3px solid ${!isEnabled ? 'var(--vscode-disabledForeground, #666)' : 'var(--vscode-progressBar-background, #0078d4)'}; ${!isEnabled ? 'opacity: 0.5;' : ''}">
							<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
								<label class="toggle-switch" title="${isEnabled ? 'Disable' : 'Enable'} this convention" style="position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer; flex-shrink: 0;">
									<input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleConventionEnabled('${c.id}', this.checked)" style="opacity: 0; width: 0; height: 0;" aria-label="${isEnabled ? 'Disable' : 'Enable'} convention: ${escapeHtml(c.title)}">
									<span role="switch" aria-checked="${isEnabled}" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: ${isEnabled ? 'var(--vscode-testing-iconPassed, #28a745)' : 'var(--vscode-disabledForeground, #666)'}; border-radius: 10px; transition: background 0.2s;"></span>
									<span style="position: absolute; top: 2px; left: ${isEnabled ? '16px' : '2px'}; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: left 0.2s;"></span>
								</label>
								<strong>[${c.category}]</strong>
								<span>${escapeHtml(c.title)}</span>
							</div>
							<div style="font-size: 0.9em; opacity: 0.85; margin-bottom: 6px;" id="conv-view-${c.id}">${escapeHtml(c.content).substring(0, 200)}${c.content.length > 200 ? '…' : ''}</div>
							<div id="conv-edit-${c.id}" style="display: none; margin-bottom: 6px;">
								<div style="margin-bottom: 4px;">
									<label style="font-size: 0.8em; opacity: 0.7;">Title</label>
									<input type="text" id="conv-title-editor-${c.id}" value="${escapeHtml(c.title)}" style="width: 100%; box-sizing: border-box; padding: 4px 8px; font-size: 0.9em;">
								</div>
								<div style="margin-bottom: 4px;">
									<label style="font-size: 0.8em; opacity: 0.7;">Content</label>
									<textarea id="conv-editor-${c.id}" style="width: 100%; box-sizing: border-box; min-height: 80px; padding: 6px 8px; font-size: 0.9em; font-family: inherit; resize: vertical;">${escapeHtml(c.content)}</textarea>
								</div>
								<div style="display: flex; gap: 6px;">
									<button onclick="saveConventionEdit('${c.id}')" style="font-size: 0.8em;">Save</button>
									<button class="secondary" onclick="cancelConventionEdit('${c.id}')" style="font-size: 0.8em;">Cancel</button>
								</div>
							</div>
							<div style="display: flex; gap: 6px;">
								<button class="secondary" onclick="editConvention('${c.id}')" style="font-size: 0.8em;">✏️ Edit</button>
								<button class="secondary danger" onclick="deleteConvention('${c.id}', this)" style="font-size: 0.8em;">🗑</button>
							</div>
						</div>`;
					}).join('') : '<p style="opacity: 0.5; text-align: center;">No conventions learned yet. The agent will discover these as it works.</p>';
				})()}
			</div>`;
			})()}

			<!-- Project Intelligence: Tool Hints -->
			${(() => {
				const hints = activeProject.toolHints || [];
				return `
			<div class="card" style="margin-top: 16px;">
				<h3 style="margin: 0 0 12px 0;">🔧 Tool Hints</h3>
				<p style="opacity: 0.7; margin-bottom: 12px; font-size: 0.9em;">
					Search patterns that work (and don't work) in this codebase. Use checkboxes to select which ones are injected.<br/>
					<span style="font-size: 0.85em;">If none selected, top 5 by recency are injected by default.</span>
				</p>
				${(() => {
					const selectedHintIds = new Set(activeProject.selectedToolHintIds || []);
					return hints.length > 0 ? hints.map(h => {
						const isSelected = selectedHintIds.has(h.id);
						return `
						<div style="padding: 8px 12px; margin-bottom: 6px; border-radius: 6px; background: var(--vscode-editor-background); display: flex; align-items: center; gap: 8px; border-left: 3px solid ${isSelected ? 'var(--vscode-testing-iconPassed)' : 'transparent'};">
							<input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleToolHintSelection('${h.id}')" title="Include in prompt injection" style="width: 16px; height: 16px; cursor: pointer;">
							<span>🔍</span>
							<span style="flex-grow: 1;">Search <strong>"${escapeHtml(h.pattern)}"</strong>${h.antiPattern ? ` not <s>"${escapeHtml(h.antiPattern)}"</s>` : ''} <span style="opacity: 0.6; font-size: 0.85em;">(${escapeHtml(h.example)})</span></span>
							<button class="secondary danger" onclick="deleteToolHint('${h.id}', this)" style="font-size: 0.8em; padding: 2px 6px;">×</button>
						</div>`;
					}).join('') : '<p style="opacity: 0.5; text-align: center;">No tool hints yet. The agent learns these from search trial-and-error.</p>';
				})()}
			</div>`;
			})()}

			<!-- Project Intelligence: Working Notes -->
			${(() => {
				const notes = activeProject.workingNotes || [];
				return `
			<div class="card" style="margin-top: 16px;">
				<h3 style="margin: 0 0 12px 0;">📝 Working Notes <span style="font-weight: normal; font-size: 0.85em;">(${notes.length})</span></h3>
				<p style="opacity: 0.7; margin-bottom: 12px; font-size: 0.9em;">
					Insights the agent discovered while exploring the codebase. Matched by file path for task-relevant injection.
				</p>
				${notes.length > 0 ? notes.map(n => {
					const stalenessIcon = n.staleness === 'fresh' ? '🟢' : n.staleness === 'possibly-stale' ? '⚠️' : '🔴';
					const stalenessStyle = n.staleness !== 'fresh' ? 'border-left-color: var(--vscode-inputValidation-warningBackground, #8b6914);' : '';
					return `
					<details style="padding: 10px 12px; margin-bottom: 8px; border-radius: 6px; background: var(--vscode-editor-background); border-left: 3px solid var(--vscode-testing-iconPassed); ${stalenessStyle}">
						<summary style="cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;">
							<span style="margin-right: 4px;">▶</span>
							<span>${stalenessIcon}</span>
							<strong style="flex-grow: 1;">${escapeHtml(n.subject)}</strong>
							<span style="font-size: 0.8em; opacity: 0.6; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background);">${n.staleness}</span>
						</summary>
						<div style="margin-top: 8px; font-size: 0.9em; opacity: 0.85;">${renderMarkdown(n.insight)}</div>
						${n.relatedFiles.length > 0 ? `<div style="margin-top: 6px; font-size: 0.8em; opacity: 0.6;">Files: ${n.relatedFiles.map(f => '<code>' + escapeHtml(f.split(/[\\/]/).pop() || f) + '</code>').join(', ')}</div>` : ''}
						${n.relatedSymbols.length > 0 ? `<div style="margin-top: 4px; font-size: 0.8em; opacity: 0.6;">Symbols: ${n.relatedSymbols.map(s => '<code>' + escapeHtml(s) + '</code>').join(', ')}</div>` : ''}
						<div style="display: flex; gap: 6px; margin-top: 8px;">
							${n.staleness !== 'fresh' ? `<button class="secondary" onclick="markNoteFresh('${n.id}')" style="font-size: 0.8em;">🔄 Mark Fresh</button>` : ''}
							${n.confidence === 'inferred' ? `<button class="secondary danger" onclick="discardWorkingNote('${n.id}')" style="font-size: 0.8em;">✗ Discard</button>` : ''}
							<button class="secondary danger" onclick="deleteWorkingNote('${n.id}', this)" style="font-size: 0.8em;">🗑</button>
						</div>
					</details>`;
				}).join('') : '<p style="opacity: 0.5; text-align: center;">No working notes yet. The agent creates these automatically during exploration.</p>'}
			</div>`;
			})()}
		` : `
			<div class="empty-state">
				<p>Select a project first.</p>
			</div>
		`}
	</div>

	<!-- Settings Tab -->
	<div id="tab-settings" class="tab-content" role="tabpanel" aria-labelledby="tabBtn-settings"${currentTab !== 'settings' ? ' style="display: none;"' : ''}>
		${(() => {
			const cfg = vscode.workspace.getConfiguration('contextManager');
			return `
		<div class="card">
			<h3 style="margin-top: 0;">⚙ Extension Settings</h3>
			<p class="dashboard-text-muted" style="margin-bottom: 20px;">Changes are saved immediately.</p>
			<input type="text" placeholder="Search settings..." class="settings-search" oninput="filterSettings(this.value)">

			<!-- General -->
			<details class="dashboard-settings-section" open>
				<summary><span class="section-toggle">▶</span> General</summary>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Show Status Bar</strong>
						<div class="setting-desc">Show active project in the status bar</div>
					</div>
					<input type="checkbox" ${cfg.get('showStatusBar', true) ? 'checked' : ''}
						onchange="updateSetting('showStatusBar', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Confirm Delete</strong>
						<div class="setting-desc">Show confirmation before deleting items</div>
					</div>
					<input type="checkbox" ${cfg.get('confirmDelete', true) ? 'checked' : ''}
						onchange="updateSetting('confirmDelete', this.checked)">
				</label>
			</details>






			<!-- Project Intelligence / Auto-Learn -->
			<details class="dashboard-settings-section">
				<summary><span class="section-toggle">▶</span> 🧠 Project Intelligence &amp; Auto-Learn</summary>
				<div class="dashboard-info-box">
					<strong>Intelligence Pipeline Architecture</strong><br>
					<strong style="color: var(--vscode-charts-green);">WRITE</strong> mechanisms capture knowledge from interactions: <strong>Auto-Capture</strong> records raw observations, <strong>Auto-Distill</strong> (WS1) refines them into conventions/cards, and <strong>Auto-Learn</strong> extracts structured patterns during chat.<br>
					<strong style="color: var(--vscode-charts-blue);">READ</strong> mechanism: <strong>Tiered Injection</strong> intelligently injects learned conventions and card index into prompts based on relevance.
				</div>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Tiered Injection</strong>
						<div class="setting-desc"><strong style="color: var(--vscode-charts-blue);">[READ]</strong> Auto-inject learned conventions and knowledge card index into prompts (Tier 1: always-on conventions, Tier 2: queried cards)</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.enableTieredInjection', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.enableTieredInjection', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Auto-Learn</strong>
						<div class="setting-desc"><strong style="color: var(--vscode-charts-green);">[WRITE]</strong> Automatically extract conventions, tool hints, and working notes from chat interactions (runs in background after responses)</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.autoLearn', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Use LLM for Extraction</strong>
						<div class="setting-desc">Use a lightweight LLM call for higher-precision convention/note extraction (falls back to regex if unavailable)</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.useLLM', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.autoLearn.useLLM', this.checked)">
				</label>
				<div class="setting-row">
					<div class="setting-info">
						<strong>Extraction Model</strong>
						<div class="setting-desc">Model family for background LLM extraction. Choose a small/cheap model to minimize cost.</div>
					</div>
					<select class="dashboard-input-narrow-140"
						onchange="updateSetting('intelligence.autoLearn.modelFamily', this.value)">
						<option value="" ${!(cfg.get('intelligence.autoLearn.modelFamily', '') as string) ? 'selected' : ''}>Default</option>
						${this._availableModelFamilies.map(f =>
							`<option value="${f}" ${(cfg.get('intelligence.autoLearn.modelFamily', '') as string) === f ? 'selected' : ''}>${escapeHtml(f)}</option>`
						).join('')}
					</select>
				</div>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Show Notifications</strong>
						<div class="setting-desc">Show a toast notification when new learnings are auto-extracted</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.showInChat', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.autoLearn.showInChat', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Extract Tool Hints</strong>
						<div class="setting-desc">Learn search patterns from fail→success tool call sequences</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.extractToolHints', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.autoLearn.extractToolHints', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Extract Working Notes</strong>
						<div class="setting-desc">Learn file relationships from co-access patterns</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.extractWorkingNotes', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.autoLearn.extractWorkingNotes', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Extract Conventions</strong>
						<div class="setting-desc">Learn codebase conventions from AI responses</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.autoLearn.extractConventions', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.autoLearn.extractConventions', this.checked)">
				</label>
				<div class="setting-row">
					<div class="setting-info">
						<strong>Discard Threshold</strong>
						<div class="setting-desc">Suppress a signal category after this many user discards (0 = never suppress)</div>
					</div>
					<input type="number" min="0" max="50" value="${cfg.get('intelligence.autoLearn.discardThreshold', 5)}"
						class="dashboard-input-narrow"
						onchange="updateSetting('intelligence.autoLearn.discardThreshold', parseInt(this.value) || 0)">
				</div>
				<div class="setting-row">
					<div class="setting-info">
						<strong>Expiry (days)</strong>
						<div class="setting-desc">Auto-expire inferred items after this many days (0 = never)</div>
					</div>
					<input type="number" min="0" max="365" value="${cfg.get('intelligence.autoLearn.expiryDays', 0)}"
						class="dashboard-input-narrow"
						onchange="updateSetting('intelligence.autoLearn.expiryDays', parseInt(this.value) || 0)">
				</div>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Staleness Tracking</strong>
						<div class="setting-desc">Flag working notes as stale when their referenced files change in git</div>
					</div>
					<input type="checkbox" ${cfg.get('intelligence.enableStalenessTracking', true) ? 'checked' : ''}
						onchange="updateSetting('intelligence.enableStalenessTracking', this.checked)">
				</label>
			</details>

			<!-- Auto-Distill -->
			<details class="dashboard-settings-section">
				<summary><span class="section-toggle">▶</span> 🔄 Auto-Distill</summary>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Enable Auto-Distill</strong>
						<div class="setting-desc"><strong style="color: var(--vscode-charts-green);">[WRITE]</strong> Automatically distill observations into conventions and knowledge cards at compaction checkpoints</div>
					</div>
					<input type="checkbox" ${cfg.get('autoDistill.enabled', true) ? 'checked' : ''}
						onchange="updateSetting('autoDistill.enabled', this.checked)">
				</label>
				<div class="setting-row">
					<div class="setting-info">
						<strong>Distill Interval (minutes)</strong>
						<div class="setting-desc">Minimum time between automatic distillation runs per project (5-120 minutes)</div>
					</div>
					<input type="number" min="5" max="120" value="${cfg.get('autoDistill.intervalMinutes', 30)}"
						class="dashboard-input-narrow"
						onchange="updateSetting('autoDistill.intervalMinutes', parseInt(this.value) || 30)">
				</div>
				<div class="setting-row">
					<div class="setting-info">
						<strong>Deduplication Threshold</strong>
						<div class="setting-desc">Jaccard similarity threshold for detecting duplicates: 0.5 (loose, more merges) to 1.0 (strict, exact only)</div>
					</div>
					<input type="number" min="0.5" max="1.0" step="0.05" value="${cfg.get('autoDistill.dedupThreshold', 0.8)}"
						class="dashboard-input-narrow"
						onchange="updateSetting('autoDistill.dedupThreshold', parseFloat(this.value) || 0.8)">
				</div>
			</details>

			<!-- Save-as-Card -->
			<details class="dashboard-settings-section">
				<summary><span class="section-toggle">▶</span> 💾 Save-as-Card</summary>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Enable Smart Merge</strong>
						<div class="setting-desc">Check for semantic overlap with existing cards before saving (prevents duplicates via LLM detection)</div>
					</div>
					<input type="checkbox" ${cfg.get('saveAsCard.smartMerge', true) ? 'checked' : ''}
						onchange="updateSetting('saveAsCard.smartMerge', this.checked)">
				</label>\n\t\t\t</details>


			<!-- Auto-Capture -->
			<details class="dashboard-settings-section">
				<summary><span class="section-toggle">▶</span> 📸 Auto-Capture</summary>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Enable Auto-Capture</strong>
						<div class="setting-desc"><strong style="color: var(--vscode-charts-green);">[WRITE]</strong> Record raw observations from all chat participants (Copilot, @workspace, etc.) — foundation of intelligence pipeline</div>
					</div>
					<input type="checkbox" ${cfg.get('autoCapture.enabled', true) ? 'checked' : ''}
						onchange="updateSetting('autoCapture.enabled', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Learn from All Participants</strong>
						<div class="setting-desc">Run lightweight LLM extraction on all chats to learn conventions &amp; working notes</div>
					</div>
					<input type="checkbox" ${cfg.get('autoCapture.learnFromAllParticipants', true) ? 'checked' : ''}
						onchange="updateSetting('autoCapture.learnFromAllParticipants', this.checked)">
				</label>
				<div class="setting-row">
					<div class="setting-info">
						<strong>Max Observations</strong>
						<div class="setting-desc">Circular buffer size — older observations evicted when full (10-200)</div>
					</div>
					<input type="number" min="10" max="200" value="${cfg.get('autoCapture.maxObservations', 50)}"
						class="dashboard-input-narrow"
						onchange="updateSetting('autoCapture.maxObservations', parseInt(this.value) || 50)">
				</div>
			</details>

			<!-- Agent Hooks -->
			<details class="dashboard-settings-section">
				<summary><span class="section-toggle">▶</span> 🪝 Agent Hooks</summary>
				<p class="dashboard-section-desc">
					Capture from <strong>all</strong> Copilot agent sessions via VS Code's hook system —
					Click <strong>Install Hooks</strong> below to set up scripts in the active project.
				</p>
				<label class="setting-row">
					<div class="setting-info">
						<strong>UserPromptSubmit — Inject Memory</strong>
						<div class="setting-desc">Inject selected cards &amp; custom instructions into every prompt via session-context.txt</div>
					</div>
					<input type="checkbox" ${cfg.get('hooks.sessionStart', true) ? 'checked' : ''}
						onchange="updateSetting('hooks.sessionStart', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>PostToolUse — Capture Tool Calls</strong>
						<div class="setting-desc">Record individual tool invocations (file edits, searches, terminal commands)</div>
					</div>
					<input type="checkbox" ${cfg.get('hooks.postToolUse', true) ? 'checked' : ''}
						onchange="updateSetting('hooks.postToolUse', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>PreCompact — Save Before Compact</strong>
						<div class="setting-desc">Capture the session transcript before VS Code truncates conversation history</div>
					</div>
					<input type="checkbox" ${cfg.get('hooks.preCompact', true) ? 'checked' : ''}
						onchange="updateSetting('hooks.preCompact', this.checked)">
				</label>
				<label class="setting-row">
					<div class="setting-info">
						<strong>Stop — Capture Session End</strong>
						<div class="setting-desc">Save the full conversation when an agent session ends</div>
					</div>
					<input type="checkbox" ${cfg.get('hooks.stop', true) ? 'checked' : ''}
						onchange="updateSetting('hooks.stop', this.checked)">
				</label>
				<div style="margin-top: 12px;">
					<button onclick="vscode.postMessage({command:'runVscodeCommand',commandId:'contextManager.installHooks'})" style="margin-right: 8px;">⬇️ Install Hooks</button>
					<span style="opacity: 0.6; font-size: 0.82em;">Copies scripts → ~/.contextmanager/scripts/ and hooks.json → .github/hooks/</span>
				</div>
			</details>

			<!-- Prompt Customization -->
			<details class="dashboard-settings-section">
				<summary><span class="section-toggle">▶</span> ✏️ Prompt Customization</summary>
				<p class="dashboard-section-desc">
					Edit the system prompts injected into each command. Changes take effect immediately.
				</p>
				<div class="setting-row dashboard-setting-vertical">
					<div class="setting-info" style="margin-bottom: 6px;">
						<strong>Global Instructions</strong>
						<div class="setting-desc">Appended to every prompt (all commands)</div>
					</div>
					<textarea rows="3" class="dashboard-prompt-textarea"
						onchange="updateSetting('prompts.globalInstructions', this.value)"
						placeholder="e.g. Always respond in bullet points. Prefer TypeScript examples.">${escapeHtml(cfg.get('prompts.globalInstructions', '') as string)}</textarea>
				</div>
				${(() => {
					const defaultPrompts: Record<string, { label: string; desc: string; text: string }> = {
						chat: {
							label: 'Chat',
							desc: 'Default conversational prompt',
							text: 'You are an autonomous codebase research agent. Your job is to thoroughly investigate the user\'s question by exploring the codebase using tools before answering.\n\n## Critical Rules\n- ALWAYS use tools first. Do NOT answer from memory or assumptions.\n- Search broadly: find definitions, usages, related files, imports, tests, and configuration.\n- Read the actual code before making any claim — do not guess file contents.\n- Keep exploring until you have comprehensive evidence. If one search doesn\'t find what you need, try different search terms, file patterns, or approaches.\n- Do NOT stop after 2-3 tool calls. A thorough answer typically requires 5-15+ tool calls.\n- Cite specific file paths and line numbers for every claim.\n- If your first search returns no results, try alternative terms or broader patterns.',
						},
						explain: {
							label: '/explain',
							desc: 'Symbol explanation prompt',
							text: 'You are a code documentation assistant. Given a symbol name, thoroughly investigate it using the available tools.\n\nUse tools as many times as needed — search for the definition, read the code, search for usages, read related files, follow imports, and explore anything relevant. Do not stop exploring prematurely; keep calling tools until you have a comprehensive understanding.\n\nThen explain:\n- **Purpose** (cite the file and line numbers)\n- **Key behavior** (what it does, with code quotes)\n- For classes: **Key methods** (only methods you found in the code)\n- **How it fits** into the broader architecture\n\nOnly state verified facts. Cite file paths and line numbers for every claim.',
						},
						usage: {
							label: '/usage',
							desc: 'Usage analysis prompt',
							text: 'You are a code analysis assistant. Given a usage site, thoroughly investigate it using the available tools.\n\nUse tools as many times as needed — search for the calling code, read the definition being called, find other usages, explore related patterns, and follow the data flow. Do not stop exploring prematurely; keep calling tools until you fully understand the usage context.\n\nThen explain:\n- **Why** is this symbol used here? (cite specific code)\n- **What role** does it play in this context? (quote relevant code)\n- **Notable patterns** (only with cited evidence)\n- **Data flow** — how data arrives and leaves through this usage\n\nOnly state verified facts. Cite file paths and line numbers for every claim.',
						},
						relationships: {
							label: '/relationships',
							desc: 'Architecture analysis prompt',
							text: 'You are a code architecture assistant. Given a class name, thoroughly investigate it using the available tools.\n\nUse tools as many times as needed — search for the class definition, find parent classes, explore interfaces it implements, search for collaborators, read how other classes reference it, and trace the full inheritance chain. Do not stop exploring prematurely; keep calling tools until you have a complete picture of the architecture.\n\nThen explain:\n- **Role** in the architecture (cite file and inheritance chain)\n- **Parent classes & interfaces** (only those you found)\n- **Key collaborators** (only verified interactions)\n- **Design pattern** (only with cited evidence)\n\nOnly state verified facts. Cite file paths and line numbers for every claim.',
						},
						research: {
							label: '/research',
							desc: 'Knowledge card generation prompt',
							text: 'You are a codebase expert. Research the given topic and create a comprehensive knowledge card.\n\nUse tools to thoroughly search and read the codebase — call as many tools as you need to build a comprehensive understanding. Follow imports, read related files, search for usages and patterns.\n\nOnce you have enough information, output the card.',
						},
						refine: {
							label: '/refine',
							desc: 'Knowledge card refinement prompt',
							text: 'You are a codebase expert. You are refining an existing knowledge card based on user instructions.\n\nUse tools to search the codebase as thoroughly as needed to gather additional information. Then REFINE the existing knowledge card.\n\n- Keep existing accurate information — do NOT discard good content\n- ADD new insights, correct errors, update outdated information, or restructure as instructed\n- Once you have enough information, output the refined card.',
						},
						distillObservations: {
							label: 'Distill Observations',
							desc: 'Extracts conventions, tool hints, and working notes from session observations',
							text: 'You are analyzing observations from an AI coding agent\'s session history to extract reusable project intelligence.\n\nExtract the following from the observations below. Be specific and actionable.\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "conventions": [\n    { "title": "short title (5-10 words)", "category": "architecture|naming|patterns|testing|tooling|pitfalls", "content": "clear description" }\n  ],\n  "toolHints": [\n    { "toolName": "which tool/search strategy", "pattern": "what works", "example": "concrete example" }\n  ],\n  "workingNotes": [\n    { "subject": "what area/component", "insight": "what was learned", "relatedFiles": ["file1"] }\n  ]\n}\n\nGuidelines:\n- Skip generic advice. Only include things specific to THIS codebase.\n- Max 5 each. If nothing meaningful found, return empty array.',
						},
						distillQueue: {
							label: 'Distill Queue',
							desc: 'Synthesizes card queue entries into knowledge card proposals',
							text: 'You are extracting knowledge cards from AI chat responses for a software project reference.\n\nTurn each response into one or more self-contained knowledge cards that PRESERVE the full technical details.\nDo NOT summarize or compress — a card should be as detailed as the source material.\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "cards": [\n    {\n      "title": "descriptive title (5-10 words)",\n      "category": "architecture|pattern|convention|explanation|note",\n      "content": "full technical content — preserve code snippets, exact values, caveats verbatim.",\n      "reasoning": "which response(s) this came from and why",\n      "confidence": 0.85,\n      "sourceIndices": [1]\n    }\n  ]\n}\n\nGuidelines:\n- One card per distinct topic\n- Preserve markdown formatting, code blocks, and lists\n- Do not skip responses — every response should produce at least one card',
						},
						synthesizeCard: {
							label: 'AI Draft / Synthesize',
							desc: 'Generates a single knowledge card from selected sources in the card editor',
							text: 'You are synthesizing a knowledge card for a software project reference.\n\nCreate ONE comprehensive knowledge card that captures all important technical details.\nPreserve code snippets, file paths, commands, exact values, and step-by-step instructions verbatim.\nA developer reading this card alone should learn everything from it.\n\nReturn ONLY valid JSON:\n{\n  "title": "descriptive title (5-10 words)",\n  "category": "architecture|pattern|convention|explanation|note",\n  "content": "full markdown content — preserve code blocks, lists, and formatting",\n  "tags": ["tag1", "tag2"]\n}',
						},
					};
					return Object.entries(defaultPrompts).map(([key, p]) => {
						const customValue = cfg.get('prompts.' + key, '') as string;
						const isCustom = customValue.trim().length > 0;
						return `
				<div class="setting-row dashboard-setting-vertical" style="margin-top: 14px;">
					<div class="setting-info" style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
						<strong>${p.label}</strong>
						<span style="font-size: 0.8em; padding: 1px 6px; border-radius: 8px; background: ${isCustom ? 'var(--vscode-inputValidation-warningBackground, #8b6914)' : 'var(--vscode-badge-background)'}; color: ${isCustom ? 'var(--vscode-inputValidation-warningForeground, #fff)' : 'var(--vscode-badge-foreground)'};">${isCustom ? 'customized' : 'default'}</span>
					</div>
					<div class="setting-desc" style="margin-bottom: 6px;">${p.desc}</div>
					<textarea rows="6" class="dashboard-prompt-textarea"
						onchange="updateSetting('prompts.${key}', this.value)">${escapeHtml(isCustom ? customValue : p.text)}</textarea>
					${isCustom ? `<button class="secondary" style="margin-top: 4px; font-size: 0.8em; align-self: flex-start;" onclick="resetPrompt('${key}')">Reset to Default</button>` : ''}
				</div>`;
					}).join('');
				})()}
			</details>
		</div>
		`;
		})()}

		<div class="dashboard-settings-section">
			<h4 class="dashboard-section-heading">📦 Data Management</h4>
			<p class="setting-desc" style="margin-bottom: 12px;">Export your projects and data to a file, or import from a previously exported file.</p>
			<div class="dashboard-button-group" style="margin-bottom: 16px;">
				<button onclick="exportAll()" title="Export all projects, knowledge cards, TODOs, branches, and cache to a single file">📤 Export All Data</button>
				<button class="secondary" onclick="importAll()" title="Import data from a previously exported file">📥 Import Data</button>
			</div>
			<div class="dashboard-button-group" style="align-items: center;">
				<button onclick="exportProject()" ${activeProject ? '' : 'disabled style="opacity: 0.5; cursor: not-allowed;"'} title="Export just the active project and its data">📤 Export Current Project</button>
				<button class="secondary" onclick="importProject()" title="Import a single project from a file">📥 Import Project</button>
				${!activeProject ? '<span style="font-size: 0.8em; opacity: 0.7;">Select a project to export it</span>' : ''}
			</div>
			<h4 style="margin: 16px 0 12px 0;">📁 File-Based Sync (Git-Tracked)</h4>
			<p class="setting-desc" style="margin-bottom: 12px;">Export cards as markdown files to <code>.contextmanager/cards/</code> for git tracking and team sharing. Import from any folder of .md files.</p>
			<div class="dashboard-button-group" style="margin-bottom: 12px;">
				<button onclick="exportCardsToFiles()" ${activeProject ? '' : 'disabled style="opacity: 0.5; cursor: not-allowed;"'} title="Export cards as .md files to .contextmanager/cards/ in project root">📁 Export Cards to Filesystem</button>
				<button class="secondary" onclick="importCardsFromDir()" ${activeProject ? '' : 'disabled style="opacity: 0.5; cursor: not-allowed;"'} title="Import .md files from any folder as knowledge cards">📥 Import from Markdown Folder</button>
			</div>
		</div>
	</div>

	<div id="newProjectModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100;">
		<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--card-bg); padding: 24px; border-radius: 8px; min-width: 400px;">
			<h3 style="margin-top: 0;">Create New Project</h3>
			<div class="form-group">
				<label>Project Name</label>
				<input type="text" id="newProjectName" placeholder="My Project">
			</div>
			<button onclick="createProject()">Create</button>
			<button class="secondary" onclick="hideNewProjectForm()">Cancel</button>
		</div>
	</div>

	${getDashboardScript(activeProject?.id || '', this._currentTab || this.initialTab || 'intelligence', nonce)}
</body>
</html>`;
	}

}

