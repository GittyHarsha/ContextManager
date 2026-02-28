/**
 * Dashboard CSS styles — extracted from DashboardPanel._getHtmlForWebview.
 */

export function getDashboardStyles(): string {
	return `<style>
		:root {
			--bg-color: var(--vscode-editor-background);
			--fg-color: var(--vscode-editor-foreground);
			--border-color: var(--vscode-panel-border);
			--button-bg: var(--vscode-button-background);
			--button-fg: var(--vscode-button-foreground);
			--input-bg: var(--vscode-input-background);
			--input-fg: var(--vscode-input-foreground);
			--input-border: var(--vscode-input-border);
			--card-bg: var(--vscode-editorWidget-background);
		}
		
		* { box-sizing: border-box; }
		
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--fg-color);
			background: var(--bg-color);
			padding: 20px;
			margin: 0;
		}
		
		.header {
			display: flex;
			align-items: center;
			gap: 16px;
			margin-bottom: 24px;
			padding-bottom: 16px;
			border-bottom: 1px solid var(--border-color);
		}
		
		.header h1 {
			margin: 0;
			font-size: 1.5em;
			flex-grow: 1;
		}
		
		select, input, textarea {
			background: var(--input-bg);
			color: var(--input-fg);
			border: 1px solid var(--input-border);
			padding: 6px 10px;
			border-radius: 4px;
			font-family: inherit;
			font-size: inherit;
		}
		
		button {
			background: var(--button-bg);
			color: var(--button-fg);
			border: none;
			padding: 6px 12px;
			border-radius: 4px;
			cursor: pointer;
			font-family: inherit;
			font-size: inherit;
		}
		
		button:hover {
			opacity: 0.9;
		}
		
		button.secondary {
			background: transparent;
			border: 1px solid var(--border-color);
			color: var(--fg-color);
		}
		
		button.danger {
			background: var(--vscode-errorForeground);
		}
		
		.tabs {
			display: flex;
			gap: 0;
			margin-bottom: 20px;
			border-bottom: 1px solid var(--border-color);
		}
		
		.tab {
			padding: 10px 20px;
			cursor: pointer;
			border-bottom: 2px solid transparent;
			opacity: 0.7;
		}
		
		.tab.active {
			border-bottom-color: var(--button-bg);
			opacity: 1;
		}
		
		.tab:hover {
			opacity: 1;
		}
		
		.card {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 6px;
			padding: 16px;
			margin-bottom: 16px;
		}
		
		.card h3 {
			margin: 0 0 12px 0;
			font-size: 1.1em;
		}
		
		.grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 20px;
		}
		
		@media (max-width: 800px) {
			.grid { grid-template-columns: 1fr; }
		}
		
		.todo-item {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 8px 0;
			border-bottom: 1px solid var(--border-color);
		}
		
		.todo-item:last-child {
			border-bottom: none;
		}
		
		.todo-status {
			width: 20px;
			height: 20px;
			border: 2px solid var(--border-color);
			border-radius: 50%;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		
		.todo-status.completed {
			background: var(--vscode-testing-iconPassed);
			border-color: var(--vscode-testing-iconPassed);
		}

		.todo-status.in-progress {
			background: var(--vscode-warningForeground);
			border-color: var(--vscode-warningForeground);
			animation: pulse 1.5s ease-in-out infinite;
		}

		@keyframes pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.5; }
		}

		.spinner {
			display: inline-block;
			width: 16px;
			height: 16px;
			border: 2px solid var(--fg-color);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 0.8s linear infinite;
		}
		@keyframes spin {
			to { transform: rotate(360deg); }
		}

		.file-status {
			display: inline-block;
			width: 18px;
			font-weight: bold;
			font-size: 0.85em;
		}
		.file-status.M { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
		.file-status.A { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
		.file-status.D { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
		.file-status.U { color: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991); }
		.file-status.C { color: var(--vscode-gitDecoration-stageModifiedResourceForeground, #e2c08d); opacity: 0.7; }
		
		.todo-title {
			flex-grow: 1;
		}
		
		.todo-title.completed {
			text-decoration: line-through;
			opacity: 0.6;
		}
		
		.priority-high { color: var(--vscode-errorForeground); }
		.priority-medium { color: var(--vscode-warningForeground); }
		.priority-low { opacity: 0.6; }
		
		.cache-item {
			padding: 12px 0;
			border-bottom: 1px solid var(--border-color);
		}
		
		.cache-item:last-child {
			border-bottom: none;
		}
		
		.cache-item summary::-webkit-details-marker,
		.file-group summary::-webkit-details-marker {
			display: none;
		}
		
		.cache-item summary > span:first-child,
		.file-group summary > span:first-child {
			display: inline-block;
			transition: transform 0.2s;
		}
		
		.cache-item[open] summary > span:first-child,
		.file-group[open] summary > span:first-child {
			transform: rotate(90deg);
		}
		
		.cache-header {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		
		.cache-symbol {
			font-weight: bold;
			font-family: var(--vscode-editor-font-family);
		}
		
		.cache-type {
			background: var(--button-bg);
			color: var(--button-fg);
			padding: 2px 8px;
			border-radius: 10px;
			font-size: 0.85em;
		}
		
		.cache-file {
			font-size: 0.9em;
			opacity: 0.7;
			font-family: var(--vscode-editor-font-family);
		}
		
		.cache-explanation {
			margin-top: 8px;
			padding: 10px;
			background: var(--bg-color);
			border-radius: 4px;
			font-size: 0.95em;
			max-height: 400px;
			overflow-y: auto;
			white-space: pre-wrap;
		}
		
		/* Search and Filter */
		.search-filter-bar {
			display: flex;
			gap: 12px;
			margin-bottom: 16px;
			flex-wrap: wrap;
			align-items: center;
		}
		
		.search-input {
			flex-grow: 1;
			min-width: 200px;
			padding: 8px 12px;
			border-radius: 4px;
			background: var(--input-bg);
			border: 1px solid var(--input-border);
			font-size: 0.95em;
		}

		.knowledge-folder-tree {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.knowledge-folder-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			padding: 6px 8px;
			border: 1px solid var(--border-color);
			border-radius: 4px;
			background: var(--card-bg);
		}

		.knowledge-folder-left {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			min-width: 0;
		}

		.knowledge-folder-name {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 420px;
		}

		.knowledge-folder-actions {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
		}

		/* Tree folder headers — collapsible sections */
		.knowledge-tree-folder {
			margin-bottom: 4px;
			border: 1px solid transparent;
			border-radius: 6px;
			transition: border-color 0.15s, background 0.15s;
		}

		.knowledge-tree-folder.drag-over {
			border-color: var(--vscode-focusBorder, #007fd4);
			background: rgba(0, 127, 212, 0.06);
		}

		.knowledge-tree-folder > div {
			overflow: visible;
		}

		/* Ensure last card actions are always reachable */
		.knowledge-tree-folder:last-child {
			margin-bottom: 40px;
		}

		.knowledge-tree-folder > summary::-webkit-details-marker,
		.knowledge-tree-folder > summary::marker {
			display: none;
		}

		.knowledge-tree-folder-header {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 10px;
			font-weight: 600;
			font-size: 0.92em;
			border-bottom: 1px solid var(--border-color);
			margin-bottom: 4px;
			border-radius: 4px;
			user-select: none;
		}

		.knowledge-tree-folder-header:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.folder-toggle-arrow {
			display: inline-block;
			width: 14px;
			font-size: 0.8em;
			transition: transform 0.15s;
			text-align: center;
		}

		.knowledge-tree-folder[open] > summary .folder-toggle-arrow {
			transform: rotate(90deg);
		}

		.knowledge-tree-folder-actions {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			margin-left: auto;
			opacity: 0;
			transition: opacity 0.15s;
		}

		.knowledge-tree-folder-header:hover .knowledge-tree-folder-actions {
			opacity: 1;
		}

		/* Drag-and-drop card visual feedback */
		.cache-header[draggable="true"] {
			transition: opacity 0.15s;
		}

		.cache-item.dragging {
			opacity: 0.4;
		}

		/* Passive status badges shown in card summary row */
		.card-status-badges {
			margin-left: auto;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			flex-shrink: 0;
		}

		.card-badge {
			font-size: 0.78em;
			opacity: 0.7;
			pointer-events: none;
			user-select: none;
		}

		.card-badge-warn {
			color: var(--vscode-warningForeground, #cca700);
			font-size: 0.72em;
			padding: 1px 5px;
			border: 1px solid currentColor;
			border-radius: 8px;
			opacity: 0.65;
		}

		/* Flag toggle buttons in expanded card detail */
		.card-flag-btn {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 3px 10px;
			border-radius: 12px;
			border: 1px solid var(--border-color);
			background: transparent;
			color: var(--fg-color);
			font-size: 0.88em;
			cursor: pointer;
			opacity: 0.55;
			transition: opacity 0.15s, background 0.15s, border-color 0.15s;
		}

		.card-flag-btn:hover {
			opacity: 0.85;
			background: var(--vscode-list-hoverBackground);
		}

		.card-flag-btn.active {
			opacity: 1;
			background: var(--vscode-badge-background, rgba(0, 127, 212, 0.12));
			border-color: var(--vscode-focusBorder, #007fd4);
		}

		/* Keep legacy class for any remaining usages */
		.knowledge-track-toggle {
			margin-left: auto;
			display: inline-flex;
			align-items: center;
			gap: 4px;
			font-size: 0.82em;
			opacity: 0.7;
			cursor: pointer;
			transition: opacity 0.15s;
		}

		.knowledge-track-toggle:hover {
			opacity: 1;
		}
		
		.filter-select {
			padding: 6px 10px;
			border-radius: 4px;
		}
		
		.bulk-actions {
			display: flex;
			gap: 8px;
			padding: 8px 12px;
			background: var(--vscode-editorWidget-background);
			border-radius: 4px;
			margin-bottom: 12px;
			align-items: center;
		}
		
		.bulk-actions.hidden {
			display: none;
		}
		
		.bulk-select-all {
			margin-right: 8px;
		}
		
		.item-checkbox {
			margin-right: 8px;
			cursor: pointer;
		}
		
		/* Markdown Preview Improvements */
		.markdown-content {
			line-height: 1.6;
		}
		
		.markdown-content h1, .markdown-content h2, .markdown-content h3 {
			margin-top: 1em;
			margin-bottom: 0.5em;
		}
		
		.markdown-content h1 { font-size: 1.5em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
		.markdown-content h2 { font-size: 1.3em; }
		.markdown-content h3 { font-size: 1.1em; }
		
		.markdown-content code {
			background: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
			font-family: var(--vscode-editor-font-family);
			font-size: 0.9em;
		}
		
		.markdown-content pre {
			background: var(--vscode-textCodeBlock-background);
			padding: 12px;
			border-radius: 4px;
			overflow-x: auto;
			margin: 8px 0;
		}
		
		.markdown-content pre code {
			background: none;
			padding: 0;
		}
		
		.markdown-content ul, .markdown-content ol {
			padding-left: 2em;
		}
		
		.markdown-content li {
			margin: 4px 0;
		}
		
		.markdown-content blockquote {
			border-left: 4px solid var(--vscode-textBlockQuote-border);
			padding-left: 16px;
			margin: 8px 0;
			opacity: 0.8;
		}
		
		.markdown-content a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		
		.markdown-content a:hover {
			text-decoration: underline;
		}
		
		.markdown-content table {
			border-collapse: collapse;
			margin: 8px 0;
		}
		
		.markdown-content table td, .markdown-content table th {
			border: 1px solid var(--border-color);
			padding: 6px 12px;
		}
		
		.markdown-content table th {
			background:var(--vscode-editorWidget-background);
			font-weight: bold;
		}
		
		/* Hidden items */
		.filtered-out {
			display: none !important;
		}
		
		/* Stats badge */
		.stats-badge {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 8px;
			border-radius: 10px;
			font-size: 0.85em;
			margin-left: 8px;
		}

		.inline-edit {
			margin-top: 8px;
		}

		.inline-edit-textarea {
			width: 100%;
			min-height: 300px;
			max-height: 80vh;
			padding: 12px;
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-family: var(--vscode-editor-font-family);
			font-size: 0.95em;
			resize: vertical;
			white-space: pre-wrap;
			box-sizing: border-box;
			overflow-y: auto;
		}

		.inline-edit-actions {
			display: flex;
			gap: 8px;
			margin-top: 8px;
		}
		
		.cache-actions {
			display: flex;
			gap: 8px;
			margin-top: 8px;
		}
		
		.empty-state {
			text-align: center;
			padding: 40px;
			opacity: 0.6;
		}
		
		.form-group {
			margin-bottom: 12px;
		}
		
		.form-group label {
			display: block;
			margin-bottom: 4px;
			font-weight: 500;
		}
		
		.form-group input,
		.form-group textarea {
			width: 100%;
		}
		
		.form-group textarea {
			min-height: 80px;
			resize: vertical;
		}

		.setting-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 10px 12px;
			border-radius: 6px;
			cursor: pointer;
			margin-bottom: 4px;
			transition: background 0.15s;
		}
		.setting-row:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.setting-info {
			flex: 1;
			margin-right: 16px;
		}
		.setting-desc {
			font-size: 0.85em;
			opacity: 0.7;
			margin-top: 2px;
		}
		.setting-row input[type="checkbox"] {
			width: 18px;
			height: 18px;
			flex-shrink: 0;
		}
		.setting-row input[type="number"] {
			flex-shrink: 0;
			text-align: center;
		}
		.setting-row select {
			flex-shrink: 0;
		}

		/* Context menu on knowledge card text selection */
		.card-context-menu {
			position: fixed;
			background: var(--vscode-menu-background, var(--bg-color));
			border: 1px solid var(--vscode-menu-border, var(--border-color));
			border-radius: 6px;
			padding: 4px 0;
			min-width: 180px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.3);
			z-index: 9999;
			display: none;
		}
		.card-context-menu.visible { display: block; }
		.card-context-menu-item {
			padding: 6px 16px;
			cursor: pointer;
			font-size: 0.9em;
			color: var(--vscode-menu-foreground, var(--fg-color));
			white-space: nowrap;
		}
		.card-context-menu-item:hover {
			background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
			color: var(--vscode-menu-selectionForeground, var(--fg-color));
		}
		.card-context-menu-sep {
			height: 1px;
			background: var(--border-color);
			margin: 4px 8px;
		}

		/* Highlight text selection inside knowledge card views */
		[id^="card-view-"] ::selection {
			background: var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.7));
			color: var(--vscode-editor-selectionForeground, #fff);
		}

		/* Inline modal for context menu actions */
		.inline-modal-overlay {
			position: fixed;
			top: 0; left: 0; right: 0; bottom: 0;
			background: rgba(0,0,0,0.4);
			z-index: 10000;
			display: none;
			align-items: center;
			justify-content: center;
		}
		.inline-modal-overlay.visible { display: flex; }
		.inline-modal {
			background: var(--vscode-editorWidget-background, var(--bg-color));
			border: 1px solid var(--vscode-editorWidget-border, var(--border-color));
			border-radius: 8px;
			padding: 20px;
			min-width: 380px;
			max-width: 500px;
			box-shadow: 0 8px 24px rgba(0,0,0,0.4);
		}
		.inline-modal h3 {
			margin: 0 0 6px 0;
			font-size: 1.05em;
		}
		.inline-modal .modal-hint {
			font-size: 0.85em;
			opacity: 0.7;
			margin-bottom: 12px;
			word-break: break-word;
		}
		.inline-modal input, .inline-modal textarea {
			width: 100%;
			padding: 8px;
			box-sizing: border-box;
			margin-bottom: 12px;
			border-radius: 4px;
			border: 1px solid var(--input-border);
			background: var(--input-bg);
			color: var(--input-fg);
			font-family: inherit;
			font-size: 0.95em;
		}
		.inline-modal textarea { min-height: 60px; resize: vertical; }
		.inline-modal .modal-buttons {
			display: flex;
			gap: 8px;
			justify-content: flex-end;
		}

		/* ── Settings search ── */
		.settings-search {
			width: 100%;
			padding: 8px 12px;
			margin-bottom: 16px;
			border-radius: 4px;
			background: var(--input-bg);
			border: 1px solid var(--input-border);
			color: var(--input-fg);
			font-size: 0.95em;
		}

		/* ── Collapsible settings sections ── */
		.dashboard-settings-section {
			margin-bottom: 24px;
		}
		.dashboard-settings-section > summary {
			margin: 0 0 12px 0;
			padding-bottom: 6px;
			border-bottom: 1px solid var(--vscode-widget-border);
			opacity: 0.8;
			font-weight: 600;
			font-size: 1em;
			cursor: pointer;
			user-select: none;
			list-style: none;
		}
		.dashboard-settings-section > summary::-webkit-details-marker {
			display: none;
		}
		.dashboard-settings-section > summary::marker {
			display: none;
			content: '';
		}
		.dashboard-settings-section > summary:hover {
			opacity: 1;
		}
		.dashboard-settings-section > summary .section-toggle {
			display: inline-block;
			width: 14px;
			font-size: 0.8em;
			transition: transform 0.15s;
			text-align: center;
		}
		.dashboard-settings-section[open] > summary .section-toggle {
			transform: rotate(90deg);
		}

		/* ── Common inline-style replacements ── */
		.dashboard-section-heading {
			margin: 0 0 12px 0;
			padding-bottom: 6px;
			border-bottom: 1px solid var(--vscode-widget-border);
			opacity: 0.8;
		}
		.dashboard-input-narrow {
			width: 60px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			padding: 4px 6px;
		}
		.dashboard-input-narrow-70 {
			width: 70px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			padding: 4px 6px;
		}
		.dashboard-input-narrow-140 {
			width: 140px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			padding: 4px 6px;
		}
		.dashboard-prompt-textarea {
			width: 100%;
			resize: vertical;
			font-family: var(--vscode-editor-font-family);
			font-size: 12px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			padding: 6px;
		}
		.dashboard-section-desc {
			opacity: 0.7;
			margin: 0 0 12px 0;
			font-size: 0.85em;
		}
		.dashboard-text-muted {
			opacity: 0.7;
		}
		.dashboard-setting-vertical {
			flex-direction: column;
			align-items: stretch;
		}
		.dashboard-button-group {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.dashboard-info-box {
			background: var(--vscode-textBlockQuote-background);
			border-left: 3px solid var(--vscode-textLink-foreground);
			padding: 10px 12px;
			margin-bottom: 16px;
			font-size: 0.9em;
			line-height: 1.5;
		}

		/* ─── Card Canvas: Sub-tabs ─────────────────────────────── */
		.knowledge-subtabs {
			display: flex;
			gap: 0;
			margin-bottom: 16px;
			border-bottom: 1px solid var(--border-color);
		}
		.knowledge-subtab {
			padding: 8px 16px;
			cursor: pointer;
			font-size: 0.9em;
			border-bottom: 2px solid transparent;
			opacity: 0.7;
			transition: opacity 0.15s, border-color 0.15s;
			user-select: none;
		}
		.knowledge-subtab:hover { opacity: 0.9; }
		.knowledge-subtab.active {
			opacity: 1;
			border-bottom-color: var(--button-bg);
			font-weight: 600;
		}
		.knowledge-subtab .subtab-badge {
			display: inline-block;
			min-width: 18px;
			padding: 0 5px;
			margin-left: 6px;
			font-size: 0.78em;
			text-align: center;
			border-radius: 9px;
			background: var(--vscode-badge-background, rgba(255,255,255,0.15));
			color: var(--vscode-badge-foreground, inherit);
		}

		/* ─── Card Canvas: Tile Grid ────────────────────────────── */
		.card-tile-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
			gap: 12px;
			margin-bottom: 16px;
		}
		.card-tile {
			position: relative;
			border: 1px solid var(--border-color);
			border-radius: 6px;
			padding: 14px;
			background: var(--card-bg);
			cursor: pointer;
			transition: box-shadow 0.15s, border-color 0.15s, transform 0.1s;
			display: flex;
			flex-direction: column;
			gap: 8px;
			min-height: 120px;
		}
		.card-tile:hover {
			box-shadow: 0 2px 8px rgba(0,0,0,0.2);
			border-color: var(--vscode-focusBorder, #007fd4);
		}
		.card-tile.selected {
			border-color: var(--vscode-testing-iconPassed, #4caf50);
			box-shadow: 0 0 0 1px var(--vscode-testing-iconPassed, #4caf50);
		}
		.card-tile.queue-tile {
			border-style: dashed;
		}
		.card-tile.editing {
			border-color: var(--button-bg);
			box-shadow: 0 0 0 2px var(--button-bg);
		}

		/* Tile header */
		.card-tile-header {
			display: flex;
			align-items: flex-start;
			gap: 8px;
		}
		.card-tile-header input[type="checkbox"] {
			flex-shrink: 0;
			width: 16px;
			height: 16px;
			margin-top: 2px;
			cursor: pointer;
		}
		.card-tile-title {
			flex: 1;
			font-weight: 600;
			font-size: 0.92em;
			line-height: 1.3;
			overflow: hidden;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
		}

		/* Category badge */
		.card-tile-category {
			display: inline-block;
			font-size: 0.72em;
			padding: 2px 8px;
			border-radius: 10px;
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.3px;
		}
		.card-tile-category.cat-architecture { background: rgba(156,39,176,0.2); color: #ce93d8; }
		.card-tile-category.cat-pattern { background: rgba(33,150,243,0.2); color: #90caf9; }
		.card-tile-category.cat-convention { background: rgba(76,175,80,0.2); color: #a5d6a7; }
		.card-tile-category.cat-explanation { background: rgba(255,152,0,0.2); color: #ffcc80; }
		.card-tile-category.cat-note { background: rgba(158,158,158,0.2); color: #bdbdbd; }
		.card-tile-category.cat-other { background: rgba(96,125,139,0.2); color: #b0bec5; }

		/* Tile meta row */
		.card-tile-meta {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-wrap: wrap;
			font-size: 0.78em;
			opacity: 0.65;
		}

		/* Tag pills */
		.card-tile-tags {
			display: flex;
			gap: 4px;
			flex-wrap: wrap;
		}
		.tag-pill {
			display: inline-flex;
			align-items: center;
			gap: 3px;
			padding: 1px 8px;
			font-size: 0.78em;
			border-radius: 10px;
			background: var(--vscode-badge-background, rgba(255,255,255,0.1));
			color: var(--vscode-badge-foreground, inherit);
		}
		.tag-pill .tag-remove {
			cursor: pointer;
			opacity: 0.5;
			font-size: 0.9em;
			margin-left: 2px;
		}
		.tag-pill .tag-remove:hover { opacity: 1; }

		/* Tile snippet */
		.card-tile-snippet {
			font-size: 0.82em;
			opacity: 0.7;
			line-height: 1.4;
			overflow: hidden;
			display: -webkit-box;
			-webkit-line-clamp: 3;
			-webkit-box-orient: vertical;
		}

		/* Tile quick actions (visible on hover) */
		.card-tile-actions {
			position: absolute;
			top: 8px;
			right: 8px;
			display: none;
			gap: 4px;
		}
		.card-tile:hover .card-tile-actions { display: flex; }
		.card-tile-actions button {
			padding: 2px 6px;
			font-size: 0.78em;
			border-radius: 4px;
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			color: var(--fg-color);
			cursor: pointer;
		}
		.card-tile-actions button:hover {
			background: var(--button-bg);
			color: var(--button-fg);
		}

		/* Confidence bar (queue tiles) */
		.confidence-bar {
			height: 3px;
			border-radius: 2px;
			background: var(--border-color);
			margin-top: auto;
		}
		.confidence-bar-fill {
			height: 100%;
			border-radius: 2px;
			background: var(--vscode-testing-iconPassed, #4caf50);
			transition: width 0.3s;
		}

		/* ─── Card Canvas: Multi-Select Action Bar ──────────────── */
		.multi-select-bar {
			display: none;
			align-items: center;
			gap: 8px;
			padding: 10px 14px;
			background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.05));
			border: 1px solid var(--button-bg);
			border-radius: 6px;
			margin-bottom: 12px;
			flex-wrap: wrap;
		}
		.multi-select-bar.visible { display: flex; }
		.multi-select-bar .select-count {
			font-size: 0.88em;
			font-weight: 600;
			margin-right: 4px;
		}

		/* ─── Card Canvas: Tool Call Viewer ─────────────────────── */
		.tc-viewer-badge {
			display: inline-flex;
			align-items: center;
			gap: 3px;
			font-size: 0.78em;
			opacity: 0.6;
			cursor: pointer;
		}
		.tc-viewer-badge:hover { opacity: 1; }

		.tc-viewer {
			margin-top: 8px;
			border: 1px solid var(--border-color);
			border-radius: 6px;
			overflow: hidden;
			font-size: 0.85em;
		}
		.tc-viewer-header {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 12px;
			background: var(--vscode-textBlockQuote-background, rgba(0,0,0,0.1));
			cursor: pointer;
			user-select: none;
			font-weight: 500;
		}
		.tc-viewer-header:hover { opacity: 0.8; }
		.tc-viewer-body { padding: 0; }
		.tc-viewer-body.collapsed { display: none; }
		.tc-call-row {
			border-top: 1px solid var(--border-color);
			padding: 8px 12px;
		}
		.tc-call-row:first-child { border-top: none; }
		.tc-call-name {
			color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
			font-weight: 600;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.92em;
			cursor: pointer;
		}
		.tc-call-name:hover { text-decoration: underline; }
		.tc-call-section {
			margin-top: 6px;
			padding: 6px 10px;
			background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
			border-radius: 4px;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.88em;
			line-height: 1.4;
			max-height: 200px;
			overflow-y: auto;
			white-space: pre-wrap;
			word-break: break-all;
		}
		.tc-call-section.truncated { max-height: 120px; overflow: hidden; position: relative; }
		.tc-call-section.truncated::after {
			content: '';
			position: absolute;
			bottom: 0;
			left: 0;
			right: 0;
			height: 40px;
			background: linear-gradient(transparent, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15)));
		}
		.tc-show-more {
			font-size: 0.82em;
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
			margin-top: 4px;
			display: inline-block;
		}
		.tc-show-more:hover { text-decoration: underline; }
		.tc-file-link {
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
			text-decoration: none;
		}
		.tc-file-link:hover { text-decoration: underline; }
		.tc-call-label {
			font-size: 0.78em;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			opacity: 0.5;
			margin-top: 6px;
			margin-bottom: 2px;
		}
		.tc-evidence-group {
			margin-bottom: 12px;
			padding-bottom: 8px;
			border-bottom: 1px dashed var(--border-color);
		}
		.tc-evidence-group:last-child { border-bottom: none; }
		.tc-evidence-label {
			font-size: 0.82em;
			opacity: 0.7;
			font-weight: 600;
			margin-bottom: 6px;
		}

		/* ─── Card Canvas: Rich Editor Panel ────────────────────── */
		.card-editor-panel {
			display: none;
			border: 1px solid var(--button-bg);
			border-radius: 8px;
			margin-top: 12px;
			margin-bottom: 16px;
			overflow: hidden;
			animation: slideIn 0.2s ease-out;
		}
		.card-editor-panel.visible { display: block; }
		@keyframes slideIn {
			from { opacity: 0; transform: translateY(-8px); }
			to { opacity: 1; transform: translateY(0); }
		}
		.card-editor-panel-header {
			display: flex;
			align-items: center;
			padding: 10px 14px;
			background: var(--vscode-textBlockQuote-background, rgba(0,0,0,0.1));
			border-bottom: 1px solid var(--border-color);
			gap: 8px;
		}
		.card-editor-panel-header h4 { margin: 0; flex: 1; font-size: 0.95em; }
		.card-editor-split {
			display: grid;
			grid-template-columns: 1fr 1fr;
			min-height: 300px;
		}
		.card-editor-form {
			padding: 14px;
			display: flex;
			flex-direction: column;
			gap: 10px;
			border-right: 1px solid var(--border-color);
			overflow-y: auto;
			max-height: 600px;
		}
		.card-editor-form label {
			font-size: 0.82em;
			font-weight: 600;
			opacity: 0.8;
			margin-bottom: 2px;
		}
		.card-editor-form input[type="text"],
		.card-editor-form select {
			width: 100%;
			padding: 6px 10px;
			background: var(--input-bg);
			color: var(--input-fg);
			border: 1px solid var(--input-border, var(--border-color));
			border-radius: 4px;
			font-family: inherit;
			font-size: 0.9em;
		}
		.card-editor-form textarea {
			width: 100%;
			min-height: 180px;
			padding: 10px;
			background: var(--input-bg);
			color: var(--input-fg);
			border: 1px solid var(--input-border, var(--border-color));
			border-radius: 4px;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.88em;
			line-height: 1.5;
			resize: vertical;
		}
		.card-editor-preview {
			padding: 14px;
			overflow-y: auto;
			max-height: 600px;
			line-height: 1.6;
			font-size: 0.9em;
		}
		.card-editor-preview h1,
		.card-editor-preview h2,
		.card-editor-preview h3 { margin-top: 12px; margin-bottom: 8px; }
		.card-editor-preview code {
			background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
			padding: 1px 4px;
			border-radius: 3px;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.92em;
		}
		.card-editor-preview pre {
			background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
			padding: 10px;
			border-radius: 4px;
			overflow-x: auto;
		}
		.card-editor-preview pre code { background: none; padding: 0; }
		.card-editor-footer {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 10px 14px;
			border-top: 1px solid var(--border-color);
			background: var(--vscode-textBlockQuote-background, rgba(0,0,0,0.1));
		}
		.card-editor-footer button { font-size: 0.88em; }

		/* Source material & anchors in editor */
		.editor-source-material {
			border: 1px solid var(--border-color);
			border-radius: 4px;
			margin-top: 8px;
		}
		.editor-source-material summary {
			padding: 6px 10px;
			font-size: 0.82em;
			cursor: pointer;
			opacity: 0.7;
		}
		.editor-source-material summary:hover { opacity: 1; }
		.editor-source-material .source-content {
			padding: 8px 12px;
			font-size: 0.85em;
			max-height: 200px;
			overflow-y: auto;
			border-top: 1px solid var(--border-color);
			line-height: 1.5;
		}

		.anchor-pills {
			display: flex;
			gap: 4px;
			flex-wrap: wrap;
			margin-top: 6px;
		}

		/* AI progress spinner (inline) */
		.ai-progress-spinner {
			display: inline-block;
			width: 12px;
			height: 12px;
			border: 2px solid var(--vscode-textLink-foreground, #007acc);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 0.8s linear infinite;
			vertical-align: middle;
			margin-right: 4px;
		}
		#editor-status {
			font-size: 0.82em;
			padding: 4px 0;
			min-height: 20px;
			color: var(--vscode-descriptionForeground);
		}

		/* Distill card proposals — rendered markdown */
		.distilled-card-preview p, .distilled-card-full p { margin: 4px 0; }
		.distilled-card-preview code, .distilled-card-full code {
			background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
			padding: 1px 4px; border-radius: 3px; font-size: 0.9em;
		}
		.distilled-card-preview pre, .distilled-card-full pre {
			background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
			padding: 8px 10px; border-radius: 4px; overflow-x: auto;
			margin: 6px 0; font-size: 0.88em;
		}
		.distilled-card-preview h1, .distilled-card-full h1,
		.distilled-card-preview h2, .distilled-card-full h2,
		.distilled-card-preview h3, .distilled-card-full h3 {
			margin: 6px 0 4px 0; font-size: 1em;
		}
		.distilled-card-preview li, .distilled-card-full li { margin-left: 16px; }
		.anchor-pill {
			display: inline-flex;
			align-items: center;
			gap: 3px;
			padding: 2px 8px;
			font-size: 0.78em;
			border-radius: 10px;
			background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.08));
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
		}
		.anchor-pill:hover { text-decoration: underline; }

		/* Tags editor in editor panel */
		.tags-editor {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			align-items: center;
			padding: 4px;
			background: var(--input-bg);
			border: 1px solid var(--input-border, var(--border-color));
			border-radius: 4px;
			min-height: 32px;
		}
		.tags-editor input {
			border: none;
			background: transparent;
			color: var(--input-fg);
			outline: none;
			font-size: 0.85em;
			padding: 2px 4px;
			flex: 1;
			min-width: 80px;
		}

		/* Accessibility: Focus indicators */
		button:focus-visible,
		.tab:focus-visible,
		a:focus-visible,
		input:focus-visible,
		textarea:focus-visible,
		select:focus-visible,
		[role="tab"]:focus-visible,
		[role="switch"]:focus-visible,
		.card-flag-btn:focus-visible,
		.card-context-menu-item:focus-visible,
		.todo-status:focus-visible,
		.setting-row:focus-visible {
			outline: 2px solid var(--vscode-focusBorder, #007fd4);
			outline-offset: 2px;
		}

		.tab:focus-visible {
			outline-offset: -2px;
			border-radius: 2px;
		}
	</style>`;
}
