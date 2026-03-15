/**
 * Client-side JavaScript for the dashboard webview.
 * Extracted from the _getHtmlForWebview template literal.
 *
 * @param activeProjectId - The ID of the currently active project (or empty string).
 * @param initialTab      - The tab to show on load (e.g. 'overview').
 */
export function getDashboardScript(activeProjectId: string, initialTab: string, nonce: string): string {
	return `<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const activeProjectId = '${activeProjectId}';

		// Restore previous state
		const previousState = vscode.getState() || {};

		function getWebviewState() {
			return vscode.getState() || {};
		}

		function mergeWebviewState(patch) {
			vscode.setState({ ...getWebviewState(), ...patch });
		}

		// ── Scroll position preservation ──
		// Save scroll position on every scroll so it survives full re-renders
		let _scrollSaveTimeout;
		window.addEventListener('scroll', () => {
			clearTimeout(_scrollSaveTimeout);
			_scrollSaveTimeout = setTimeout(() => {
				vscode.setState({ ...vscode.getState(), scrollTop: document.documentElement.scrollTop });
			}, 100);
		}, { passive: true });

		// Restore scroll position after render
		if (previousState.scrollTop) {
			requestAnimationFrame(() => {
				document.documentElement.scrollTop = previousState.scrollTop;
			});
		}

		function getCardViewScrollTops() {
			return getWebviewState().cardViewScrollTops || {};
		}

		function saveCardViewScrollTop(cardId, scrollTop) {
			if (!cardId) { return; }
			mergeWebviewState({
				cardViewScrollTops: {
					...getCardViewScrollTops(),
					[cardId]: scrollTop,
				}
			});
		}

		function restoreCardViewScrollTops() {
			var saved = previousState.cardViewScrollTops || {};
			Object.keys(saved).forEach(function(cardId) {
				var viewEl = document.getElementById('card-view-' + cardId);
				if (!viewEl) { return; }
				var scrollTop = Number(saved[cardId]);
				if (!Number.isFinite(scrollTop) || scrollTop <= 0) { return; }
				viewEl.scrollTop = scrollTop;
			});
		}

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}

		// Sets a button to a loading state (disabled + label change). Re-render restores it.
		function setButtonLoading(btn, label) {
			if (!btn) return;
			btn.disabled = true;
			btn.textContent = label || 'Working…';
			btn.style.opacity = '0.6';
		}

		function switchTab(tabName, saveState = true) {
			const tabEl = document.getElementById('tab-' + tabName);
			if (!tabEl) {
				return;
			}
			const allTabBtns = document.querySelectorAll('.tab');
			const allTabContents = document.querySelectorAll('.tab-content');
			allTabBtns.forEach(t => {
				t.classList.remove('active');
				t.setAttribute('aria-selected', 'false');
				t.setAttribute('tabindex', '-1');
			});
			allTabContents.forEach(t => t.style.display = 'none');
			const tabBtn = document.querySelector('[data-tab="' + tabName + '"]');
			if (tabBtn) {
				tabBtn.classList.add('active');
				tabBtn.setAttribute('aria-selected', 'true');
				tabBtn.setAttribute('tabindex', '0');
			}
			tabEl.style.display = 'block';

			if (saveState) {
				vscode.setState({ ...vscode.getState(), currentTab: tabName });
				vscode.postMessage({ command: 'setCurrentTab', tab: tabName });
			}
		}

		// Ensure global availability for inline onclick handlers
		window.switchTab = switchTab;
		window.bindTrackedSession = bindTrackedSession;
		window.rebindTrackedSession = rebindTrackedSession;
		window.dismissTrackedSession = dismissTrackedSession;
		window.forgetTrackedSession = forgetTrackedSession;
		window.toggleAllSelection = toggleAllSelection;
		window.toggleItemSelection = toggleItemSelection;
		window.applySessionsFilter = applySessionsFilter;
		window.clearSessionsFilters = clearSessionsFilters;
		window.bulkAssignTrackedSessions = bulkAssignTrackedSessions;
		window.bulkDismissTrackedSessions = bulkDismissTrackedSessions;
		window.bulkForgetTrackedSessions = bulkForgetTrackedSessions;

		// Keyboard navigation for tab bar (ArrowLeft/Right, Home/End)
		document.addEventListener('keydown', function(e) {
			const tablist = document.querySelector('[role="tablist"]');
			if (!tablist || !tablist.contains(document.activeElement)) return;
			const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
			const currentIndex = tabs.indexOf(document.activeElement);
			if (currentIndex === -1) return;
			let newIndex = -1;
			if (e.key === 'ArrowRight') {
				newIndex = (currentIndex + 1) % tabs.length;
			} else if (e.key === 'ArrowLeft') {
				newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
			} else if (e.key === 'Home') {
				newIndex = 0;
			} else if (e.key === 'End') {
				newIndex = tabs.length - 1;
			}
			if (newIndex >= 0) {
				e.preventDefault();
				const tabName = tabs[newIndex].getAttribute('data-tab');
				if (tabName) { switchTab(tabName, true); }
				tabs[newIndex].focus();
			}
		});

		// Fallback: delegated tab click handling in case inline onclick is ignored
		document.addEventListener('click', (event) => {
			const target = event.target;
			const tabEl = target && target.closest ? target.closest('[data-tab]') : null;
			if (tabEl) {
				const tabName = tabEl.getAttribute('data-tab');
				if (tabName) {
					event.preventDefault();
					switchTab(tabName, true);
				}
				return;
			}

			const sessionActionButton = target && target.closest ? target.closest('[data-session-action]') : null;
			if (sessionActionButton) {
				event.preventDefault();
				const action = sessionActionButton.getAttribute('data-session-action');
				const sessionId = sessionActionButton.getAttribute('data-session-id');
				if (!sessionId) { return; }
				if (action === 'bind') {
					bindTrackedSession(sessionId);
				} else if (action === 'rebind') {
					rebindTrackedSession(sessionId);
				} else if (action === 'dismiss') {
					dismissTrackedSession(sessionId);
				} else if (action === 'delete') {
					forgetTrackedSession(sessionId);
				}
				return;
			}

			const sessionBulkButton = target && target.closest ? target.closest('[data-session-bulk-action]') : null;
			if (sessionBulkButton) {
				event.preventDefault();
				const action = sessionBulkButton.getAttribute('data-session-bulk-action');
				if (action === 'assign') {
					bulkAssignTrackedSessions();
				} else if (action === 'dismiss') {
					bulkDismissTrackedSessions();
				} else if (action === 'delete') {
					bulkForgetTrackedSessions();
				}
				return;
			}

			if (target && target.id === 'sessions-clear-filters') {
				event.preventDefault();
				clearSessionsFilters();
				return;
			}

			// Delegated handler for approve-card buttons (avoids inline onclick escaping)
			if (target && target.closest) {
				var approveBtn = target.closest('.approve-card-btn');
				if (approveBtn) {
					var row = approveBtn.closest('.distilled-card-row');
					if (row) {
						approveDistilledCard(row.dataset.title, row.dataset.category, row.dataset.content, row);
					}
					return;
				}

				// ─── Card Canvas: Tile interactions ───────────────────
				var tileEditBtn = target.closest('.tile-edit-btn');
				if (tileEditBtn) {
					event.stopPropagation();
					var tileId = tileEditBtn.getAttribute('data-id');
					var tile = tileEditBtn.closest('.card-tile');
					if (tileId && tile) { openTileInEditor(tileId, tile.dataset.tileType); }
					return;
				}
				var tileDismissBtn = target.closest('.tile-dismiss-btn');
				if (tileDismissBtn) {
					event.stopPropagation();
					var tileId = tileDismissBtn.getAttribute('data-id');
					var tile = tileDismissBtn.closest('.card-tile');
					if (tileId && tile) {
						if (tile.dataset.tileType === 'queue') { rejectCandidate(tileId); }
						else { deleteCard(tileId); }
					}
					return;
				}
				var cardTile = target.closest('.card-tile');
				if (cardTile && !target.closest('input[type=checkbox]') && !target.closest('button')) {
					var tileId = cardTile.dataset.tileId;
					if (tileId) { openTileInEditor(tileId, cardTile.dataset.tileType); }
					return;
				}
				var tcFileLink = target.closest('.tc-file-link');
				if (tcFileLink) {
					event.stopPropagation();
					var path = tcFileLink.getAttribute('data-path');
					if (path) { vscode.postMessage({ command: 'openFile', path: path }); }
					return;
				}
				var anchorPill = target.closest('.anchor-pill');
				if (anchorPill) {
					event.stopPropagation();
					var path = anchorPill.getAttribute('data-path');
					var line = parseInt(anchorPill.getAttribute('data-line') || '0', 10);
					if (path) { vscode.postMessage({ command: 'openFile', path: path, line: line }); }
					return;
				}

				// Legacy queue button handlers (kept for distill/clear)
				var distillBtn = target.closest('.queue-distill-btn');
				if (distillBtn) {
					distillQueue();
					return;
				}
				var clearBtn = target.closest('.queue-clear-btn');
				if (clearBtn) {
					clearQueue();
					return;
				}
				// Distilled card: toggle show more/less
				var toggleBtn = target.closest('.distilled-toggle-btn');
				if (toggleBtn) {
					var row = toggleBtn.closest('.distilled-card-row');
					if (row) {
						var preview = row.querySelector('.distilled-card-preview');
						var full = row.querySelector('.distilled-card-full');
						if (full && preview) {
							if (full.style.display === 'none') {
								full.style.display = 'block';
								preview.style.display = 'none';
								toggleBtn.textContent = 'Show less';
							} else {
								full.style.display = 'none';
								preview.style.display = 'block';
								toggleBtn.textContent = 'Show more';
							}
						}
					}
					return;
				}
				// Distilled card: dismiss/skip
				var dismissBtn = target.closest('.dismiss-distilled-btn');
				if (dismissBtn) {
					var row = dismissBtn.closest('.distilled-card-row');
					if (row) { row.remove(); }
					return;
				}
			}
		});

		document.addEventListener('input', function(event) {
			const target = event.target;
			if (!(target instanceof HTMLElement)) { return; }
			if (target.id === 'sessions-search') {
				applySessionsFilter();
			}
		});

		document.addEventListener('change', function(event) {
			const target = event.target;
			if (!(target instanceof HTMLElement)) { return; }

			if (target.id === 'sessions-origin-filter'
				|| target.id === 'sessions-status-filter'
				|| target.id === 'sessions-project-filter'
				|| target.id === 'sessions-queued-only'
				|| target.id === 'sessions-sort') {
				applySessionsFilter();
				return;
			}

			if (target.id === 'select-all-sessions') {
				toggleAllSelection('sessions');
				return;
			}

			if (target.classList.contains('item-checkbox') && target.getAttribute('data-session-select') === 'true') {
				const sessionId = target.getAttribute('data-id');
				if (sessionId) {
					toggleItemSelection('sessions', sessionId);
				}
			}
		});

		document.addEventListener('scroll', function(event) {
			var target = event.target;
			if (!target || !target.id || !target.id.startsWith('card-view-')) { return; }
			saveCardViewScrollTop(target.id.substring('card-view-'.length), target.scrollTop);
		}, true);

		function selectProject(projectId) {
			vscode.postMessage({ command: 'setActiveProject', projectId });
		}

		function showNewProjectForm() {
			document.getElementById('newProjectModal').style.display = 'block';
			document.getElementById('newProjectName').focus();
		}

		function hideNewProjectForm() {
			document.getElementById('newProjectModal').style.display = 'none';
		}

		function createProject() {
			const name = document.getElementById('newProjectName').value.trim();
			if (name) {
				vscode.postMessage({ command: 'createProject', name });
				hideNewProjectForm();
			}
		}

		function getTrackedSessionProjectId(sessionId) {
			const select = document.getElementById('session-project-' + sessionId);
			return select ? select.value : '';
		}

		function getBulkTrackedSessionProjectId() {
			const select = document.getElementById('sessions-bulk-project');
			return select ? select.value : '';
		}

		function bindTrackedSession(sessionId) {
			const projectId = getTrackedSessionProjectId(sessionId);
			if (!projectId) { return; }
			vscode.postMessage({ command: 'bindTrackedSession', sessionId, projectId });
		}

		function rebindTrackedSession(sessionId) {
			const projectId = getTrackedSessionProjectId(sessionId);
			if (!projectId) { return; }
			vscode.postMessage({ command: 'rebindTrackedSession', sessionId, projectId });
		}

		function dismissTrackedSession(sessionId) {
			vscode.postMessage({ command: 'dismissTrackedSession', sessionId });
		}

		function forgetTrackedSession(sessionId) {
			vscode.postMessage({ command: 'forgetTrackedSession', sessionId });
		}

		function compareSessions(a, b, sortMode) {
			if (sortMode === 'oldest' || sortMode === 'newest') {
				var aTs = parseInt(a.getAttribute('data-session-last-activity') || '0', 10);
				var bTs = parseInt(b.getAttribute('data-session-last-activity') || '0', 10);
				return sortMode === 'newest' ? bTs - aTs : aTs - bTs;
			}

			if (sortMode === 'queued') {
				var aPending = parseInt(a.getAttribute('data-session-pending') || '0', 10);
				var bPending = parseInt(b.getAttribute('data-session-pending') || '0', 10);
				if (aPending !== bPending) {
					return bPending - aPending;
				}
				var aQueuedTs = parseInt(a.getAttribute('data-session-last-activity') || '0', 10);
				var bQueuedTs = parseInt(b.getAttribute('data-session-last-activity') || '0', 10);
				return bQueuedTs - aQueuedTs;
			}

			if (sortMode === 'origin') {
				var aOrigin = (a.getAttribute('data-session-origin') || '').toLowerCase();
				var bOrigin = (b.getAttribute('data-session-origin') || '').toLowerCase();
				var originCmp = aOrigin.localeCompare(bOrigin);
				if (originCmp !== 0) { return originCmp; }
			}

			var aLabel = (a.getAttribute('data-session-label') || '').toLowerCase();
			var bLabel = (b.getAttribute('data-session-label') || '').toLowerCase();
			var cmp = aLabel.localeCompare(bLabel);
			return sortMode === 'za' ? -cmp : cmp;
		}

		function sortSessions(sortMode) {
			var list = document.getElementById('sessions-list');
			if (!list) { return; }
			var items = Array.from(list.querySelectorAll('.session-item'));
			items.sort(function(a, b) { return compareSessions(a, b, sortMode); });
			items.forEach(function(item) { list.appendChild(item); });
		}

		function applySessionsFilter() {
			var items = Array.from(document.querySelectorAll('.session-item'));
			if (items.length === 0) { return; }

			var searchInput = document.getElementById('sessions-search');
			var searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();

			var originSelect = document.getElementById('sessions-origin-filter');
			var originFilter = originSelect ? originSelect.value : 'all';

			var statusSelect = document.getElementById('sessions-status-filter');
			var statusFilter = statusSelect ? statusSelect.value : 'all';

			var projectSelect = document.getElementById('sessions-project-filter');
			var projectFilter = projectSelect ? projectSelect.value : 'all';

			var queuedOnlyCb = document.getElementById('sessions-queued-only');
			var queuedOnly = queuedOnlyCb ? queuedOnlyCb.checked : false;

			var sortSelect = document.getElementById('sessions-sort');
			var sortMode = sortSelect ? sortSelect.value : 'newest';

			var visibleCount = 0;
			items.forEach(function(item) {
				var visible = true;

				if (originFilter !== 'all') {
					visible = (item.getAttribute('data-session-origin') || '') === originFilter;
				}

				if (visible && statusFilter !== 'all') {
					visible = (item.getAttribute('data-session-status') || '') === statusFilter;
				}

				if (visible && projectFilter !== 'all') {
					var itemProjectId = item.getAttribute('data-session-project-id') || '';
					visible = projectFilter === '__unbound__' ? !itemProjectId : itemProjectId === projectFilter;
				}

				if (visible && queuedOnly) {
					visible = parseInt(item.getAttribute('data-session-pending') || '0', 10) > 0;
				}

				if (visible && searchTerm) {
					var haystack = [
						item.getAttribute('data-session-label') || '',
						item.getAttribute('data-session-snippet') || '',
						item.getAttribute('data-session-id') || '',
						item.getAttribute('data-session-origin') || '',
						item.getAttribute('data-session-project-name') || '',
						item.getAttribute('data-session-cwd') || ''
					].join(' ').toLowerCase();
					visible = haystack.indexOf(searchTerm) >= 0;
				}

				item.classList.toggle('filtered-out', !visible);
				if (visible) { visibleCount++; }
			});

			sortSessions(sortMode);

			var totalCount = items.length;
			var countEl = document.getElementById('sessions-result-count');
			if (countEl) {
				countEl.textContent = visibleCount < totalCount ? (visibleCount + ' of ' + totalCount + ' sessions') : (totalCount + ' sessions');
			}

			var hasActiveFilter = !!searchTerm
				|| originFilter !== 'all'
				|| statusFilter !== 'all'
				|| projectFilter !== 'all'
				|| queuedOnly
				|| sortMode !== 'newest';
			var clearBtn = document.getElementById('sessions-clear-filters');
			if (clearBtn) {
				clearBtn.style.display = hasActiveFilter ? '' : 'none';
			}

			mergeWebviewState({
				sessionsFilter: {
					searchTerm: searchInput ? searchInput.value : '',
					origin: originFilter,
					status: statusFilter,
					project: projectFilter,
					queuedOnly: queuedOnly,
					sortMode: sortMode,
				}
			});

			updateBulkActionsVisibility('sessions');
		}

		function clearSessionsFilters() {
			var searchInput = document.getElementById('sessions-search');
			if (searchInput) { searchInput.value = ''; }
			var originSelect = document.getElementById('sessions-origin-filter');
			if (originSelect) { originSelect.value = 'all'; }
			var statusSelect = document.getElementById('sessions-status-filter');
			if (statusSelect) { statusSelect.value = 'all'; }
			var projectSelect = document.getElementById('sessions-project-filter');
			if (projectSelect) { projectSelect.value = 'all'; }
			var queuedOnlyCb = document.getElementById('sessions-queued-only');
			if (queuedOnlyCb) { queuedOnlyCb.checked = false; }
			var sortSelect = document.getElementById('sessions-sort');
			if (sortSelect) { sortSelect.value = 'newest'; }
			applySessionsFilter();
		}

		function showAddTodoForm() {
			setDraftProtectionReason('addTodoForm', true);
			document.getElementById('addTodoForm').style.display = 'block';
			document.getElementById('newTodoTitle').focus();
			setInteracting(true);
		}

		function hideAddTodoForm() {
			setDraftProtectionReason('addTodoForm', false);
			document.getElementById('addTodoForm').style.display = 'none';
			document.getElementById('newTodoTitle').value = '';
			document.getElementById('newTodoDesc').value = '';
			setInteracting(false);
		}

		function addTodo() {
			const title = document.getElementById('newTodoTitle').value.trim();
			const description = document.getElementById('newTodoDesc').value.trim();
			if (title && activeProjectId) {
				vscode.postMessage({ 
					command: 'addTodo', 
					projectId: activeProjectId, 
					title, 
					description 
				});
				hideAddTodoForm();
			}
		}

		function toggleTodo(todoId, currentStatus) {
			const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
			vscode.postMessage({
				command: 'updateTodo',
				projectId: activeProjectId,
				todoId,
				updates: { status: newStatus }
			});
		}

		function deleteTodo(todoId, btn) {
			setButtonLoading(btn, 'Deleting…');
			vscode.postMessage({
				command: 'deleteTodo',
				projectId: activeProjectId,
				todoId
			});
		}

		function saveTodoNotes(todoId) {
			const el = document.getElementById('todo-notes-' + todoId);
			if (el) {
				vscode.postMessage({
					command: 'updateTodo',
					projectId: activeProjectId,
					todoId,
					updates: { notes: el.value }
				});
			}
		}

		function editTodoTitle(todoId) {
			const span = document.getElementById('todo-title-' + todoId);
			const input = document.getElementById('todo-title-edit-' + todoId);
			if (span && input) {
				setDraftProtectionReason('todo-title-' + todoId, true);
				span.style.display = 'none';
				input.style.display = 'block';
				input.focus();
				input.select();
			}
		}

		function saveTodoTitle(todoId) {
			const span = document.getElementById('todo-title-' + todoId);
			const input = document.getElementById('todo-title-edit-' + todoId);
			if (span && input) {
				setDraftProtectionReason('todo-title-' + todoId, false);
				const newTitle = input.value.trim();
				if (newTitle) {
					vscode.postMessage({
						command: 'updateTodo',
						projectId: activeProjectId,
						todoId,
						updates: { title: newTitle }
					});
				}
				span.style.display = '';
				input.style.display = 'none';
			}
		}

		function cancelTodoTitle(todoId) {
			const span = document.getElementById('todo-title-' + todoId);
			const input = document.getElementById('todo-title-edit-' + todoId);
			if (span && input) {
				setDraftProtectionReason('todo-title-' + todoId, false);
				input.value = span.textContent.trim();
				span.style.display = '';
				input.style.display = 'none';
			}
		}

		function editTodoDesc(todoId) {
			const span = document.getElementById('todo-desc-' + todoId);
			const textarea = document.getElementById('todo-desc-edit-' + todoId);
			const buttons = document.getElementById('todo-desc-buttons-' + todoId);
			if (span && textarea && buttons) {
				setDraftProtectionReason('todo-desc-' + todoId, true);
				span.style.display = 'none';
				textarea.style.display = 'block';
				buttons.style.display = 'block';
				setInteracting(true);
				textarea.focus();
			}
		}

		function saveTodoDesc(todoId) {
			const span = document.getElementById('todo-desc-' + todoId);
			const textarea = document.getElementById('todo-desc-edit-' + todoId);
			const buttons = document.getElementById('todo-desc-buttons-' + todoId);
			if (span && textarea && buttons) {
				setDraftProtectionReason('todo-desc-' + todoId, false);
				setInteracting(false);
				vscode.postMessage({
					command: 'updateTodo',
					projectId: activeProjectId,
					todoId,
					updates: { description: textarea.value }
				});
				span.style.display = '';
				textarea.style.display = 'none';
				buttons.style.display = 'none';
			}
		}

		function cancelTodoDesc(todoId) {
			const span = document.getElementById('todo-desc-' + todoId);
			const textarea = document.getElementById('todo-desc-edit-' + todoId);
			const buttons = document.getElementById('todo-desc-buttons-' + todoId);
			if (span && textarea && buttons) {
				setDraftProtectionReason('todo-desc-' + todoId, false);
				span.style.display = '';
				textarea.style.display = 'none';
				buttons.style.display = 'none';
				setInteracting(false);
			}
		}

		function runAgent(todoId) {
			vscode.postMessage({
				command: 'runTodoAgent',
				projectId: activeProjectId,
				todoId
			});
		}

		function continueWithPrompt(todoId) {
			vscode.postMessage({
				command: 'continueWithPrompt',
				projectId: activeProjectId,
				todoId
			});
		}

		function resumeTodo(todoId) {
			vscode.postMessage({
				command: 'resumeTodo',
				projectId: activeProjectId,
				todoId
			});
		}

		function viewTodoDetails(todoId) {
			vscode.postMessage({
				command: 'viewTodoDetails',
				projectId: activeProjectId,
				todoId
			});
		}

		function viewTodoHistory(todoId) {
			vscode.postMessage({
				command: 'viewTodoHistory',
				projectId: activeProjectId,
				todoId
			});
		}

		let _contextSaveTimer = null;
		function saveContext() {
			const goals = document.getElementById('contextGoals')?.value || '';
			const conventions = document.getElementById('contextConventions')?.value || '';
			const keyFiles = (document.getElementById('contextKeyFiles')?.value || '').split('\\n').filter(f => f.trim());
			
			vscode.postMessage({
				command: 'updateProjectContext',
				projectId: activeProjectId,
				context: { goals, conventions, keyFiles }
			});

			const status = document.getElementById('contextSaveStatus');
			if (status) {
				status.textContent = '✓ Saved';
				setTimeout(() => { status.textContent = 'Auto-saves on edit'; }, 2000);
			}
		}
		function debouncedSaveContext() {
			if (_contextSaveTimer) { clearTimeout(_contextSaveTimer); }
			const status = document.getElementById('contextSaveStatus');
			if (status) { status.textContent = 'Saving...'; }
			_contextSaveTimer = setTimeout(() => { saveContext(); }, 800);
		}
		document.addEventListener('DOMContentLoaded', () => {
			['contextGoals', 'contextConventions', 'contextKeyFiles'].forEach(id => {
				const el = document.getElementById(id);
				if (el) { el.addEventListener('input', debouncedSaveContext); }
			});
		});
		setTimeout(() => {
			['contextGoals', 'contextConventions', 'contextKeyFiles'].forEach(id => {
				const el = document.getElementById(id);
				if (el && !el._autoSaveAttached) {
					el.addEventListener('input', debouncedSaveContext);
					el._autoSaveAttached = true;
				}
			});
		}, 100);

		function updateToolSharing(key, value) {
			const config = {};
			config[key] = value;
			vscode.postMessage({
				command: 'setToolSharingConfig',
				projectId: activeProjectId,
				config
			});
		}

		function updateSetting(key, value) {
			vscode.postMessage({
				command: 'updateSetting',
				key,
				value
			});
		}
		window.updateSetting = updateSetting;

		function resetPrompt(promptKey) {
			vscode.postMessage({
				command: 'updateSetting',
				key: 'prompts.' + promptKey,
				value: ''
			});
		}
		window.resetPrompt = resetPrompt;

		function filterSettings(query) {
			const q = (query || '').toLowerCase().trim();
			const sections = document.querySelectorAll('#tab-settings .dashboard-settings-section');
			sections.forEach(function(section) {
				var rows = section.querySelectorAll('.setting-row');
				var anyVisible = false;
				rows.forEach(function(row) {
					var text = (row.textContent || '').toLowerCase();
					if (!q || text.indexOf(q) !== -1) {
						row.style.display = '';
						anyVisible = true;
					} else {
						row.style.display = 'none';
					}
				});
				if (!q) {
					section.style.display = '';
				} else if (anyVisible) {
					section.style.display = '';
					section.open = true;
				} else {
					section.style.display = 'none';
				}
			});
		}
		window.filterSettings = filterSettings;

		// Knowledge Card functions
		function persistAddCardDraft() {
			var form = document.getElementById('addCardForm');
			var titleEl = document.getElementById('newCardTitle');
			var categoryEl = document.getElementById('newCardCategory');
			var folderEl = document.getElementById('newCardFolder');
			var contentEl = document.getElementById('newCardContent');
			var trackEl = document.getElementById('newCardTrackTools');
			if (!form || !titleEl || !categoryEl || !contentEl) { return; }
			mergeWebviewState({
				addCardDraft: {
					visible: form.style.display !== 'none',
					title: titleEl.value || '',
					category: categoryEl.value || 'note',
					folderId: folderEl ? folderEl.value || '' : '',
					content: contentEl.value || '',
					trackToolUsage: !!trackEl?.checked,
				}
			});
		}

		function clearAddCardDraft() {
			mergeWebviewState({ addCardDraft: null });
		}

		function restoreAddCardDraft() {
			var draft = previousState.addCardDraft;
			if (!draft) { return; }
			var form = document.getElementById('addCardForm');
			var titleEl = document.getElementById('newCardTitle');
			var categoryEl = document.getElementById('newCardCategory');
			var folderEl = document.getElementById('newCardFolder');
			var contentEl = document.getElementById('newCardContent');
			var trackEl = document.getElementById('newCardTrackTools');
			if (!form || !titleEl || !categoryEl || !contentEl) { return; }
			form.style.display = draft.visible ? 'block' : 'none';
			titleEl.value = draft.title || '';
			categoryEl.value = draft.category || 'note';
			if (folderEl) { folderEl.value = draft.folderId || ''; }
			contentEl.value = draft.content || '';
			if (trackEl) { trackEl.checked = !!draft.trackToolUsage; }
			if (draft.visible) {
				setDraftProtectionReason('addCardForm', true);
				setInteracting(true);
			} else {
				setDraftProtectionReason('addCardForm', false);
			}
		}

		function wireAddCardDraftPersistence() {
			['newCardTitle', 'newCardContent'].forEach(function(id) {
				var el = document.getElementById(id);
				if (el) { el.addEventListener('input', persistAddCardDraft); }
			});
			['newCardCategory', 'newCardFolder', 'newCardTrackTools'].forEach(function(id) {
				var el = document.getElementById(id);
				if (el) { el.addEventListener('change', persistAddCardDraft); }
			});
		}

		function showAddCardForm() {
			setDraftProtectionReason('addCardForm', true);
			document.getElementById('addCardForm').style.display = 'block';
			persistAddCardDraft();
			document.getElementById('newCardTitle').focus();
			setInteracting(true);
		}

		function generateCardWithAI() {
			vscode.postMessage({ command: 'generateCardWithAI', projectId: activeProjectId });
		}

		function hideAddCardForm() {
			setDraftProtectionReason('addCardForm', false);
			document.getElementById('addCardForm').style.display = 'none';
			document.getElementById('newCardTitle').value = '';
			document.getElementById('newCardContent').value = '';
			const folderEl = document.getElementById('newCardFolder');
			if (folderEl) { folderEl.value = ''; }
			const categoryEl = document.getElementById('newCardCategory');
			if (categoryEl) { categoryEl.value = 'note'; }
			const trackEl = document.getElementById('newCardTrackTools');
			if (trackEl) { trackEl.checked = false; }
			clearAddCardDraft();
			setInteracting(false);
		}

		function applyCardTemplate() {
			var templates = [
				{ label: 'General', value: '## Summary\\n\\n## When to use\\n\\n## Steps\\n- \\n\\n## Examples\\n\\n## Pitfalls\\n- ' },
				{ label: 'Architecture Decision Record', value: '## Decision\\n\\n## Context\\n\\n## Options Considered\\n1. \\n2. \\n\\n## Decision Outcome\\n\\n## Consequences\\n- Good: \\n- Bad: ' },
				{ label: 'API Reference', value: '## Endpoint / Function\\n\\n## Parameters\\n| Name | Type | Required | Description |\\n|------|------|----------|-------------|\\n| | | | |\\n\\n## Returns\\n\\n## Example\\n\\n## Notes' },
				{ label: 'Debugging Guide', value: '## Symptom\\n\\n## Root Cause\\n\\n## Diagnosis Steps\\n1. \\n\\n## Fix\\n\\n## Prevention' },
				{ label: 'Code Pattern', value: '## Pattern Name\\n\\n## Problem\\n\\n## Solution\\n\\n## When to use\\n\\n## When NOT to use' },
				{ label: 'Onboarding Note', value: '## What is this?\\n\\n## Key files\\n- \\n\\n## How it works\\n\\n## Common tasks\\n- \\n\\n## Gotchas' },
			];
			var contentEl = document.getElementById('newCardContent');
			if (!contentEl) { return; }
			// Show template picker
			var menu = document.getElementById('templateMenu');
			if (!menu) {
				menu = document.createElement('div');
				menu.id = 'templateMenu';
				menu.className = 'card-context-menu';
				for (var i = 0; i < templates.length; i++) {
					(function(tmpl) {
						var item = document.createElement('div');
						item.className = 'card-context-menu-item';
						item.textContent = tmpl.label;
						item.onclick = function() {
							contentEl.value = tmpl.value.split('\\\\n').join('\\n');
							persistAddCardDraft();
							menu.classList.remove('visible');
							contentEl.focus();
						};
						menu.appendChild(item);
					})(templates[i]);
				}
				document.body.appendChild(menu);
			}
			var btn = document.querySelector('[onclick="applyCardTemplate()"]');
			if (btn) {
				var rect = btn.getBoundingClientRect();
				menu.style.left = rect.left + 'px';
				menu.style.top = (rect.bottom + 4) + 'px';
			}
			menu.classList.toggle('visible');
		}

		function addCard() {
			const title = document.getElementById('newCardTitle').value.trim();
			const content = document.getElementById('newCardContent').value.trim();
			const category = document.getElementById('newCardCategory').value;
			const folderId = document.getElementById('newCardFolder')?.value || '';
			const trackToolUsage = !!document.getElementById('newCardTrackTools')?.checked;
			
			if (title && content && activeProjectId) {
				vscode.postMessage({
					command: 'addKnowledgeCard',
					projectId: activeProjectId,
					title,
					content,
					category,
					tags: [],
					folderId: folderId || undefined,
					trackToolUsage,
				});
				hideAddCardForm();
			}
		}

		async function addKnowledgeFolder() {
			if (!activeProjectId) { return; }
			const name = await showInlineModal(
				'New Knowledge Folder',
				'Create a folder to organize cards',
				'e.g., API, Architecture, Debugging',
				'Create'
			);
			if (!name || !name.trim()) { return; }
			vscode.postMessage({
				command: 'addKnowledgeFolder',
				projectId: activeProjectId,
				name: name.trim(),
			});
		}

		async function addKnowledgeSubfolder(parentFolderId) {
			if (!activeProjectId || !parentFolderId) { return; }
			const name = await showInlineModal(
				'New Subfolder',
				'Create a nested folder under this folder',
				'Subfolder name',
				'Create'
			);
			if (!name || !name.trim()) { return; }
			vscode.postMessage({
				command: 'addKnowledgeFolder',
				projectId: activeProjectId,
				name: name.trim(),
				parentFolderId,
			});
		}

		async function renameKnowledgeFolder(folderId) {
			if (!activeProjectId || !folderId) { return; }
			const name = await showInlineModal(
				'Rename Knowledge Folder',
				'Enter a new folder name',
				'Folder name',
				'Rename'
			);
			if (!name || !name.trim()) { return; }
			vscode.postMessage({
				command: 'renameKnowledgeFolder',
				projectId: activeProjectId,
				folderId,
				name: name.trim(),
			});
		}

		async function deleteKnowledgeFolder(folderId) {
			if (!activeProjectId || !folderId) { return; }
			const confirmed = await showInlineConfirm(
				'Delete Knowledge Folder',
				'Deleting a folder also deletes its subfolders; cards are kept and moved to Root. Continue?',
				'Delete Folder'
			);
			if (!confirmed) { return; }
			vscode.postMessage({
				command: 'deleteKnowledgeFolder',
				projectId: activeProjectId,
				folderId,
			});
		}

		function moveCardToFolder(cardId, folderId) {
			if (!activeProjectId || !cardId) { return; }
			vscode.postMessage({
				command: 'moveKnowledgeCard',
				projectId: activeProjectId,
				cardId,
				folderId: folderId || undefined,
			});
		}

		// ─── Drag-and-Drop Cards Between Folders ───────────────────
		let _draggedCardId = null;

		function dragCard(event, cardId) {
			_draggedCardId = cardId;
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', cardId);
			// Add visual feedback
			setTimeout(function() {
				var el = event.target.closest && event.target.closest('[data-card-id]');
				if (el) { el.classList.add('dragging'); }
			}, 0);
		}

		function dropCardOnFolder(event, folderId) {
			var cardId = event.dataTransfer.getData('text/plain') || _draggedCardId;
			if (!cardId || !activeProjectId) { return; }
			// Remove dragging class from all cards
			document.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
			_draggedCardId = null;
			moveCardToFolder(cardId, folderId || '');
		}

		// Clean up dragging state on dragend
		document.addEventListener('dragend', function() {
			document.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
			document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
			_draggedCardId = null;
		});

		function toggleCard(cardId) {
			vscode.postMessage({
				command: 'toggleCardSelection',
				projectId: activeProjectId,
				cardId
			});
		}

		function toggleCardToolUsage(cardId, enabled) {
			if (!activeProjectId || !cardId) { return; }
			// Prevent re-render from collapsing folders — mark interacting briefly
			setInteracting(true);
			vscode.postMessage({
				command: 'editKnowledgeCard',
				projectId: activeProjectId,
				cardId,
				trackToolUsage: !!enabled,
			});
			setTimeout(function() { setInteracting(false); }, 600);
		}

		/**
		 * Toggle a boolean flag on a knowledge card (pinned, archived, includeInContext).
		 * Uses the existing editKnowledgeCard message to avoid creating a new message type.
		 */
		function setCardFlag(cardId, flagName, value) {
			if (!activeProjectId || !cardId) { return; }
			setInteracting(true);
			const msg = { command: 'editKnowledgeCard', projectId: activeProjectId, cardId };
			msg[flagName] = !!value;
			vscode.postMessage(msg);
			setTimeout(function() { setInteracting(false); }, 600);
		}

		/**
		 * Toggle global flag on the card currently open in the editor.
		 * Called from the 🌐 Global checkbox in the editor footer.
		 */
		function toggleEditorGlobal(checked) {
			if (!_editorState.tileId || _editorState.tileType === 'queue') { return; }
			setCardFlag(_editorState.tileId, 'isGlobal', checked);
		}

		function uncheckAllCards() {
			vscode.postMessage({
				command: 'deselectAllCards',
				projectId: activeProjectId
			});
		}

		function saveInjection() {
			const customInstruction = document.getElementById('injectionInstruction')?.value || '';
			const includeFullContent = document.getElementById('injectionFullContent')?.checked || false;
			const includeProjectContext = document.getElementById('injectionProjectContext')?.checked || false;
			const oneShotMode = document.getElementById('injectionOneShotMode')?.checked || false;
			vscode.postMessage({ command: 'setPromptInjection', customInstruction, includeFullContent, includeProjectContext, oneShotMode });
		}

		function clearInjection() {
			vscode.postMessage({ command: 'clearPromptInjection' });
		}

		function smartSelectCards() {
			vscode.postMessage({ command: 'smartSelectCards' });
		}

		function editCard(cardId) {
			const viewEl = document.getElementById('card-view-' + cardId);
			const editEl = document.getElementById('card-edit-' + cardId);
			const editorEl = document.getElementById('card-editor-' + cardId);
			const detailsEl = editEl?.closest('details');
			if (viewEl && editEl && editorEl) {
				setDraftProtectionReason('inline-card-' + cardId, true);
				// Save scroll position before switching to edit view
				const savedScrollTop = document.documentElement.scrollTop;
				// Ensure the card stays expanded
				if (detailsEl && !detailsEl.open) {
					detailsEl.setAttribute('open', '');
				}
				viewEl.style.display = 'none';
				editEl.style.display = 'block';
				setInteracting(true);
				// Auto-size textarea to fit content (minimum 300px)
				editorEl.style.height = 'auto';
				var contentHeight = Math.max(300, editorEl.scrollHeight + 24);
				editorEl.style.height = Math.min(contentHeight, window.innerHeight * 0.8) + 'px';
				// Restore scroll position then focus
				requestAnimationFrame(function() {
					document.documentElement.scrollTop = savedScrollTop;
					editorEl.focus();
					var len = editorEl.value.length;
					editorEl.setSelectionRange(len, len);
				});
				persistInlineCardDraft(cardId);
			}
		}

		async function refineCardWithAI(cardId) {
			const instruction = await showInlineModal(
				'Refine Card with AI',
				'What should the AI do with this card?',
				'e.g., Summarize, Add examples, Fix formatting, Expand details…',
				'Refine'
			);
			if (instruction) {
				vscode.postMessage({
					command: 'refineEntireCard',
					projectId: activeProjectId,
					cardId: cardId,
					instruction: instruction
				});
			}
		}

		function saveCardEdit(cardId) {
			const titleEl = document.getElementById('card-title-editor-' + cardId);
			const editorEl = document.getElementById('card-editor-' + cardId);
			const trackEl = document.getElementById('card-track-editor-' + cardId);
			const pinnedEl = document.getElementById('card-pinned-editor-' + cardId);
			const contextEl = document.getElementById('card-context-editor-' + cardId);
			const archivedEl = document.getElementById('card-archived-editor-' + cardId);
			if (titleEl && editorEl) {
				clearInlineCardDraft(cardId);
				setDraftProtectionReason('inline-card-' + cardId, false);
				const saveBtn = document.querySelector('#card-edit-' + cardId + ' button[onclick*="saveCardEdit"]');
				setButtonLoading(saveBtn, 'Saving…');
				setInteracting(false);
				vscode.postMessage({
					command: 'editKnowledgeCard',
					projectId: activeProjectId,
					cardId,
					newTitle: titleEl.value,
					newContent: editorEl.value,
					trackToolUsage: !!trackEl?.checked,
					...(pinnedEl ? { pinned: !!pinnedEl.checked } : {}),
					...(contextEl ? { includeInContext: !!contextEl.checked } : {}),
					...(archivedEl ? { archived: !!archivedEl.checked } : {}),
				});
			}
		}

		// ─── Search & Filter Functions ──────────────────────────────────
		
		function searchTodos(query) {
			const todos = document.querySelectorAll('.todo-item');
			const filter = query.toLowerCase();
			todos.forEach(todo => {
				const title = todo.querySelector('.todo-title')?.textContent?.toLowerCase() || '';
				const desc = todo.textContent.toLowerCase();
				if (title.includes(filter) || desc.includes(filter)) {
					todo.classList.remove('filtered-out');
				} else {
					todo.classList.add('filtered-out');
				}
			});
			updateBulkActionsVisibility('todos');
		}

		function filterTodos(status) {
			const todos = document.querySelectorAll('.todo-item');
			todos.forEach(todo => {
				if (status === 'all') {
					todo.classList.remove('filtered-out');
				} else {
					const statusEl = todo.querySelector('.todo-status');
					const hasStatus = statusEl?.classList.contains(status);
					if (hasStatus || (status === 'pending' && !statusEl?.classList.contains('completed') && !statusEl?.classList.contains('in-progress'))) {
						todo.classList.remove('filtered-out');
					} else {
						todo.classList.add('filtered-out');
					}
				}
			});
			updateBulkActionsVisibility('todos');
		}

		function searchKnowledgeCards(query) {
			var input = document.getElementById('knowledge-cards-search');
			if (input) { input.value = query || ''; }
			applyKnowledgeCardsFilter();
		}

		function compareKnowledgeCards(a, b, sortMode) {
			var aPinned = a.getAttribute('data-card-pinned') === 'true' ? 1 : 0;
			var bPinned = b.getAttribute('data-card-pinned') === 'true' ? 1 : 0;
			if (aPinned !== bPinned) { return bPinned - aPinned; }

			if (sortMode === 'newest' || sortMode === 'oldest') {
				var aTs = parseInt(a.getAttribute('data-card-updated') || '0', 10);
				var bTs = parseInt(b.getAttribute('data-card-updated') || '0', 10);
				return sortMode === 'newest' ? bTs - aTs : aTs - bTs;
			}

			var aTitle = (a.getAttribute('data-card-title') || '').toLowerCase();
			var bTitle = (b.getAttribute('data-card-title') || '').toLowerCase();
			var cmp = aTitle.localeCompare(bTitle);
			return sortMode === 'za' ? -cmp : cmp;
		}

		function sortKnowledgeCardsWithinFolders(sortMode) {
			document.querySelectorAll('.knowledge-tree-folder').forEach(function(folder) {
				var cards = Array.from(folder.children).filter(function(child) {
					return child.classList && child.classList.contains('cache-item')
						&& (child.getAttribute('data-expand-id') || '').startsWith('card-');
				});
				if (cards.length < 2) { return; }

				var firstSubfolder = Array.from(folder.children).find(function(child) {
					return child.classList && child.classList.contains('knowledge-tree-folder');
				});
				var visibleCards = cards.filter(function(card) { return !card.classList.contains('filtered-out'); });
				var hiddenCards = cards.filter(function(card) { return card.classList.contains('filtered-out'); });
				visibleCards.sort(function(a, b) { return compareKnowledgeCards(a, b, sortMode); });
				hiddenCards.sort(function(a, b) { return compareKnowledgeCards(a, b, sortMode); });
				cards.forEach(function(card) {
					folder.removeChild(card);
				});
				visibleCards.concat(hiddenCards).forEach(function(card) {
					folder.insertBefore(card, firstSubfolder || null);
				});
			});
		}

		function updateKnowledgeFolderVisibility() {
			var searchInput = document.getElementById('knowledge-cards-search');
			var categoryFilter = document.getElementById('knowledge-cards-category-filter');
			var pinnedOnlyToggle = document.getElementById('knowledge-cards-pinned-only');
			var showArchivedToggle = document.getElementById('knowledge-cards-show-archived');
			var hasActiveFilter = !!(searchInput && searchInput.value.trim())
				|| !!(categoryFilter && categoryFilter.value !== 'all')
				|| !!(pinnedOnlyToggle && pinnedOnlyToggle.checked)
				|| !!(showArchivedToggle && showArchivedToggle.checked);

			var folders = Array.from(document.querySelectorAll('.knowledge-tree-folder')).reverse();
			folders.forEach(function(folder) {
				var totalDescendantCards = folder.querySelectorAll('.cache-item[data-expand-id^="card-"]').length;
				var directCards = Array.from(folder.children).filter(function(child) {
					return child.classList && child.classList.contains('cache-item')
						&& (child.getAttribute('data-expand-id') || '').startsWith('card-')
						&& !child.classList.contains('filtered-out');
				});
				var directVisibleSubfolders = Array.from(folder.children).filter(function(child) {
					return child.classList && child.classList.contains('knowledge-tree-folder')
						&& !child.classList.contains('filtered-out');
				});
				var hasVisibleContent = directCards.length > 0 || directVisibleSubfolders.length > 0;
				folder.classList.toggle('filtered-out', !hasVisibleContent);

				var countEl = folder.querySelector('.knowledge-tree-folder-count');
				if (countEl) {
					var visibleDescendantCards = folder.querySelectorAll('.cache-item[data-expand-id^="card-"]:not(.filtered-out)').length;
					if (totalDescendantCards === 0) {
						countEl.textContent = '(empty)';
					} else if (hasActiveFilter && visibleDescendantCards !== totalDescendantCards) {
						countEl.textContent = '(' + visibleDescendantCards + ' of ' + totalDescendantCards + ')';
					} else {
						countEl.textContent = '(' + totalDescendantCards + ')';
					}
				}
			});
		}

		function applyKnowledgeCardsFilter() {
			var cards = Array.from(document.querySelectorAll('.cache-item[data-expand-id^="card-"]'));
			if (cards.length === 0) { return; }

			var searchInput = document.getElementById('knowledge-cards-search');
			var searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();

			var categorySelect = document.getElementById('knowledge-cards-category-filter');
			var categoryFilter = categorySelect ? categorySelect.value : 'all';

			var pinnedOnlyCb = document.getElementById('knowledge-cards-pinned-only');
			var pinnedOnly = pinnedOnlyCb ? pinnedOnlyCb.checked : false;

			var showArchivedCb = document.getElementById('knowledge-cards-show-archived');
			var showArchived = showArchivedCb ? showArchivedCb.checked : true;

			var sortSelect = document.getElementById('knowledge-cards-sort');
			var sortMode = sortSelect ? sortSelect.value : 'az';

			var visibleCount = 0;
			cards.forEach(function(card) {
				var visible = true;
				if (categoryFilter !== 'all') {
					visible = (card.getAttribute('data-card-category') || '') === categoryFilter;
				}
				if (visible && pinnedOnly) {
					visible = card.getAttribute('data-card-pinned') === 'true';
				}
				if (visible && !showArchived) {
					visible = card.getAttribute('data-card-archived') !== 'true';
				}
				if (visible && searchTerm) {
					var title = (card.getAttribute('data-card-title') || '').toLowerCase();
					var content = (card.textContent || '').toLowerCase();
					var tags = (card.getAttribute('data-card-tags') || '').toLowerCase();
					var categoryText = (card.getAttribute('data-card-category') || '').toLowerCase();
					visible = title.indexOf(searchTerm) >= 0
						|| content.indexOf(searchTerm) >= 0
						|| tags.indexOf(searchTerm) >= 0
						|| categoryText.indexOf(searchTerm) >= 0;
				}
				card.classList.toggle('filtered-out', !visible);
				if (visible) { visibleCount++; }
			});

			sortKnowledgeCardsWithinFolders(sortMode);
			updateKnowledgeFolderVisibility();

			var totalCount = cards.length;
			var countEl = document.getElementById('knowledge-cards-result-count');
			if (countEl) {
				countEl.textContent = visibleCount < totalCount ? (visibleCount + ' of ' + totalCount + ' cards') : (totalCount + ' cards');
			}

			var hasActiveFilter = !!searchTerm
				|| categoryFilter !== 'all'
				|| pinnedOnly
				|| !showArchived
				|| sortMode !== 'az';
			var clearBtn = document.getElementById('knowledge-cards-clear-filters');
			if (clearBtn) {
				clearBtn.style.display = hasActiveFilter ? '' : 'none';
			}

			mergeWebviewState({
				knowledgeCardsFilter: {
					searchTerm: searchInput ? searchInput.value : '',
					category: categoryFilter,
					pinnedOnly: pinnedOnly,
					showArchived: showArchived,
					sortMode: sortMode,
				}
			});

			updateBulkActionsVisibility('knowledge');
		}

		function clearKnowledgeCardsFilters() {
			var searchInput = document.getElementById('knowledge-cards-search');
			if (searchInput) { searchInput.value = ''; }
			var categorySelect = document.getElementById('knowledge-cards-category-filter');
			if (categorySelect) { categorySelect.value = 'all'; }
			var pinnedOnlyCb = document.getElementById('knowledge-cards-pinned-only');
			if (pinnedOnlyCb) { pinnedOnlyCb.checked = false; }
			var showArchivedCb = document.getElementById('knowledge-cards-show-archived');
			if (showArchivedCb) { showArchivedCb.checked = true; }
			var sortSelect = document.getElementById('knowledge-cards-sort');
			if (sortSelect) { sortSelect.value = 'az'; }
			applyKnowledgeCardsFilter();
		}

		// ─── Find within a single knowledge card (Ctrl+F equivalent) ───
		function toggleFindInCard(cardId) {
			const bar = document.getElementById('card-find-' + cardId);
			if (!bar) return;
			const isVisible = bar.style.display !== 'none';
			bar.style.display = isVisible ? 'none' : 'flex';
			if (!isVisible) {
				const input = bar.querySelector('input');
				if (input) { input.value = ''; input.focus(); }
				// Clear previous highlights
				clearFindInCard(cardId);
			} else {
				clearFindInCard(cardId);
			}
		}

		function findInCard(cardId, query) {
			const view = document.getElementById('card-view-' + cardId);
			if (!view) return;
			// Remove previous highlights
			view.querySelectorAll('mark.find-highlight').forEach(m => {
				const parent = m.parentNode;
				parent.replaceChild(document.createTextNode(m.textContent), m);
				parent.normalize();
			});
			if (!query || query.length < 2) return;
			// Walk text nodes and highlight matches
			highlightTextNodes(view, query.toLowerCase());
			// Scroll to first match
			const first = view.querySelector('mark.find-highlight');
			if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}

		function highlightTextNodes(el, query) {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
			const matches = [];
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const text = node.textContent.toLowerCase();
				let idx = text.indexOf(query);
				while (idx !== -1) {
					matches.push({ node, idx, len: query.length });
					idx = text.indexOf(query, idx + 1);
				}
			}
			// Process in reverse to avoid offset shifts
			for (let i = matches.length - 1; i >= 0; i--) {
				const { node, idx, len } = matches[i];
				const range = document.createRange();
				range.setStart(node, idx);
				range.setEnd(node, idx + len);
				const mark = document.createElement('mark');
				mark.className = 'find-highlight';
				mark.style.background = 'var(--vscode-editor-findMatchHighlightBackground, #ea5c0055)';
				mark.style.borderRadius = '2px';
				range.surroundContents(mark);
			}
		}

		function clearFindInCard(cardId) {
			const view = document.getElementById('card-view-' + cardId);
			if (!view) return;
			view.querySelectorAll('mark.find-highlight').forEach(m => {
				const parent = m.parentNode;
				parent.replaceChild(document.createTextNode(m.textContent), m);
				parent.normalize();
			});
			const bar = document.getElementById('card-find-' + cardId);
			if (bar) { bar.style.display = 'none'; const input = bar.querySelector('input'); if (input) input.value = ''; }
		}

		// ─── Intelligence Actions ──────────────────────────────────

		function toggleConventionEnabled(conventionId, enabled) {
			vscode.postMessage({ command: 'updateConvention', projectId: activeProjectId, conventionId, updates: { enabled: enabled } });
		}

		function editConvention(conventionId) {
			const viewEl = document.getElementById('conv-view-' + conventionId);
			const editEl = document.getElementById('conv-edit-' + conventionId);
			if (viewEl) viewEl.style.display = 'none';
			if (editEl) editEl.style.display = 'block';
		}

		function saveConventionEdit(conventionId) {
			const titleEl = document.getElementById('conv-title-editor-' + conventionId);
			const contentEl = document.getElementById('conv-editor-' + conventionId);
			if (titleEl && contentEl) {
				vscode.postMessage({ command: 'updateConvention', projectId: activeProjectId, conventionId, updates: { title: titleEl.value, content: contentEl.value } });
			}
		}

		function cancelConventionEdit(conventionId) {
			const viewEl = document.getElementById('conv-view-' + conventionId);
			const editEl = document.getElementById('conv-edit-' + conventionId);
			if (viewEl) viewEl.style.display = 'block';
			if (editEl) editEl.style.display = 'none';
		}

		function deleteConvention(conventionId, btn) {
			setButtonLoading(btn, 'Deleting…');
			vscode.postMessage({ command: 'deleteConvention', projectId: activeProjectId, conventionId });
		}

		function discardWorkingNote(noteId) {
			vscode.postMessage({ command: 'discardWorkingNote', projectId: activeProjectId, noteId });
		}

		function deleteToolHint(hintId, btn) {
			setButtonLoading(btn, 'Deleting…');
			vscode.postMessage({ command: 'deleteToolHint', projectId: activeProjectId, hintId });
		}

		function toggleConventionSelection(conventionId) {
			vscode.postMessage({ command: 'toggleConventionSelection', projectId: activeProjectId, conventionId });
		}

		function toggleToolHintSelection(hintId) {
			vscode.postMessage({ command: 'toggleToolHintSelection', projectId: activeProjectId, hintId });
		}

		function markNoteFresh(noteId) {
			vscode.postMessage({ command: 'updateWorkingNote', projectId: activeProjectId, noteId, updates: { staleness: 'fresh' } });
		}

		function promoteNoteToCard(noteId) {
			vscode.postMessage({ command: 'promoteNoteToCard', projectId: activeProjectId, noteId });
		}

		function deleteWorkingNote(noteId, btn) {
			setButtonLoading(btn, 'Deleting…');
			vscode.postMessage({ command: 'deleteWorkingNote', projectId: activeProjectId, noteId });
		}

		// ── Observation management ──────────────────────────────────
		let _obsFilter = 'all';
		function obsFilter(src) {
			_obsFilter = src;
			const rows = document.querySelectorAll('#obs-table tbody tr[data-src]');
			rows.forEach(function(row) {
				row.style.display = (src === 'all' || row.dataset.src === src) ? '' : 'none';
			});
			document.querySelectorAll('[id^="obs-pill-"]').forEach(function(btn) { btn.classList.remove('pill-active'); });
			const active = document.getElementById('obs-pill-' + src);
			if (active) { active.classList.add('pill-active'); }
		}

		function deleteObs(id, btn) {
			const row = btn?.closest('tr');
			if (row) { row.style.opacity = '0.4'; row.style.pointerEvents = 'none'; }
			vscode.postMessage({ command: 'deleteObservation', id });
		}

		function clearObsBySource(src) {
			if (!confirm('Clear all observations from "' + src + '"?')) { return; }
			vscode.postMessage({ command: 'clearObservationsBySource', source: src });
		}

		function closeDistillModal() {
			const m = document.getElementById('distill-modal');
			if (m) { m.style.display = 'none'; }
		}

		let _distillResult = null;
		function saveDistillSelected() {
			if (!_distillResult) { return; }
			const checked = document.querySelectorAll('#distill-sections input[type=checkbox]:checked');
			let saved = 0;
			checked.forEach((cb) => {
				const idx = parseInt(cb.dataset.idx || '0');
				const cat = cb.dataset.cat;
				if (cat === 'convention') {
					const item = _distillResult.conventions[idx];
					if (item) { vscode.postMessage({ command: 'updateConvention', projectId: activeProjectId, title: item.title, category: item.category || 'patterns', content: item.content, confidence: 'inferred', source: 'distilled from observations' }); saved++; }
				} else if (cat === 'note') {
					const item = _distillResult.workingNotes[idx];
					if (item) { vscode.postMessage({ command: 'updateWorkingNote', projectId: activeProjectId, subject: item.subject, insight: item.insight, relatedFiles: item.relatedFiles || [], source: 'distilled from observations' }); saved++; }
				}
			});
			closeDistillModal();
			// Backend calls ctx.update() after saving conventions/notes, so no manual reload needed
		}
		// Ensure global availability for inline onclick handlers
		window.obsFilter = obsFilter;
		window.deleteObs = deleteObs;
		window.closeDistillModal = closeDistillModal;
		window.saveDistillSelected = saveDistillSelected;

		function exportAll() {
			vscode.postMessage({ command: 'exportAll' });
		}

		function importAll() {
			vscode.postMessage({ command: 'importAll' });
		}

		function exportProject() {
			if (!activeProjectId) { return; }
			vscode.postMessage({ command: 'exportProject', projectId: activeProjectId });
		}

		function importProject() {
			vscode.postMessage({ command: 'importProject' });
		}

		function exportCardsToFiles() {
			if (!activeProjectId) { return; }
			vscode.postMessage({ command: 'exportCardsToFiles', projectId: activeProjectId });
		}

		function importCardsFromDir() {
			if (!activeProjectId) { return; }
			vscode.postMessage({ command: 'importCardsFromDir', projectId: activeProjectId });
		}


		function filterKnowledgeCards(category) {
			var select = document.getElementById('knowledge-cards-category-filter');
			if (select) { select.value = category || 'all'; }
			applyKnowledgeCardsFilter();
		}

		// ─── Bulk Operations ──────────────────────────────────────────

		const bulkSelection = {
			todos: new Set(),
			knowledge: new Set(),
			sessions: new Set()
		};

		function toggleAllSelection(type) {
			const checkbox = document.getElementById('select-all-' + type);
			const isChecked = checkbox?.checked || false;
			const selector = type === 'todos' ? '.todo-item:not(.filtered-out) .item-checkbox' :
				type === 'knowledge' ? '.cache-item[data-expand-id^="card-"]:not(.filtered-out) .item-checkbox' :
				type === 'sessions' ? '.session-item:not(.filtered-out) .item-checkbox' :
				'.cache-item[data-expand-id^="cache-"]:not(.filtered-out) .item-checkbox';
			
			const checkboxes = document.querySelectorAll(selector);
			checkboxes.forEach(cb => {
				cb.checked = isChecked;
				const id = cb.dataset.id;
				if (isChecked) {
					bulkSelection[type].add(id);
				} else {
					bulkSelection[type].delete(id);
				}
			});
			updateBulkActionsState(type);
		}

		function toggleItemSelection(type, id) {
			if (bulkSelection[type].has(id)) {
				bulkSelection[type].delete(id);
			} else {
				bulkSelection[type].add(id);
			}
			updateBulkActionsState(type);
		}

		function updateBulkActionsState(type) {
			const count = bulkSelection[type].size;
			const countEl = document.getElementById('bulk-count-' + type);
			const actionsEl = document.getElementById('bulk-actions-' + type);
			
			if (countEl) {
				countEl.textContent = count;
			}
			if (actionsEl) {
				if (count > 0) {
					actionsEl.classList.remove('hidden');
				} else {
					actionsEl.classList.add('hidden');
				}
			}
		}

		function updateBulkActionsVisibility(type) {
			// Update select-all checkbox state
			const checkbox = document.getElementById('select-all-' + type);
			if (checkbox) {
				checkbox.checked = false;
			}
			bulkSelection[type].clear();
			updateBulkActionsState(type);
		}

		function bulkDeleteTodos() {
			if (bulkSelection.todos.size === 0) return;
			if (confirm('Delete ' + bulkSelection.todos.size + ' TODO(s)?')) {
				bulkSelection.todos.forEach(todoId => {
					vscode.postMessage({
						command: 'deleteTodo',
						projectId: activeProjectId,
						todoId
					});
				});
				bulkSelection.todos.clear();
			}
		}

		function bulkCompleteTodos() {
			if (bulkSelection.todos.size === 0) return;
			bulkSelection.todos.forEach(todoId => {
				vscode.postMessage({
					command: 'updateTodo',
					projectId: activeProjectId,
					todoId,
					updates: { status: 'completed' }
				});
			});
			bulkSelection.todos.clear();
		}

		function bulkAssignTrackedSessions() {
			if (bulkSelection.sessions.size === 0) return;
			var projectId = getBulkTrackedSessionProjectId();
			if (!projectId) { return; }
			vscode.postMessage({
				command: 'bulkAssignTrackedSessions',
				sessionIds: Array.from(bulkSelection.sessions),
				projectId: projectId
			});
			bulkSelection.sessions.clear();
			updateBulkActionsState('sessions');
		}

		function bulkDismissTrackedSessions() {
			if (bulkSelection.sessions.size === 0) return;
			vscode.postMessage({
				command: 'bulkDismissTrackedSessions',
				sessionIds: Array.from(bulkSelection.sessions)
			});
			bulkSelection.sessions.clear();
			updateBulkActionsState('sessions');
		}

		function bulkForgetTrackedSessions() {
			if (bulkSelection.sessions.size === 0) return;
			vscode.postMessage({
				command: 'bulkForgetTrackedSessions',
				sessionIds: Array.from(bulkSelection.sessions)
			});
			bulkSelection.sessions.clear();
			updateBulkActionsState('sessions');
		}

		// Handle branch sessions data from extension
		window.addEventListener('message', event => {
			const msg = event.data;

			// ── Distillation results ──────────────────────────────────
			if (msg.command === 'distillResult') {
				const modal = document.getElementById('distill-modal');
				const loading = document.getElementById('distill-loading');
				const content = document.getElementById('distill-content');
				const errEl = document.getElementById('distill-error');
				const sections = document.getElementById('distill-sections');
				if (!modal) { return; }
				modal.style.display = 'block';
				modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				if (msg.status === 'loading') {
					if (loading) { loading.style.display = 'block'; }
					if (content) { content.style.display = 'none'; }
					return;
				}
				if (loading) { loading.style.display = 'none'; }
				if (content) { content.style.display = 'block'; }
				if (msg.error) {
					if (errEl) { errEl.textContent = msg.error; errEl.style.display = 'block'; }
					if (sections) { sections.innerHTML = ''; }
					return;
				}
				_distillResult = msg.result;
				const { conventions = [], toolHints = [], workingNotes = [] } = msg.result;
				const renderSection = (sectionTitle, items, cat, labelFn) => {
					if (!items.length) { return ''; }
					const rows = items.map((item, i) =>
						'<label style="display:flex;gap:8px;align-items:flex-start;font-size:0.88em;cursor:pointer;">' +
						'<input type="checkbox" checked data-idx="' + i + '" data-cat="' + cat + '" style="margin-top:3px;flex-shrink:0;">' +
						'<span>' + labelFn(item) + '</span></label>'
					).join('');
					return '<div style="margin-bottom:16px;"><strong style="font-size:0.9em;opacity:0.8;">' + sectionTitle + ' (' + items.length + ')</strong>' +
						'<div style="margin-top:6px;display:flex;flex-direction:column;gap:6px;">' + rows + '</div></div>';
				};
				if (sections) {
					sections.innerHTML = [
						renderSection('🏗 Conventions', conventions, 'convention', (c) =>
							'<strong>' + c.title + '</strong> <span style="opacity:0.6;font-size:0.85em;">' + c.category + '</span><br><span style="opacity:0.8;">' + c.content + '</span>'),
						renderSection('🔧 Tool Hints', toolHints, 'toolHint', (h) =>
							'<strong>' + h.toolName + '</strong>: ' + h.pattern + (h.example ? ' — <em>' + h.example + '</em>' : '')),
						renderSection('📝 Working Notes', workingNotes, 'note', (n) =>
							'<strong>' + n.subject + '</strong><br><span style="opacity:0.8;">' + n.insight + '</span>'),
					].join('');
				}
				return;
			}



			// ── Queue distillation results ───────────────────────────────────────────
			if (msg.command === 'distillQueueResult') {
				const resultsEl = document.getElementById('distill-queue-results');
				if (!resultsEl) { return; }
				resultsEl.style.display = 'block';
				if (msg.status === 'loading') {
					resultsEl.innerHTML = '<div style="opacity:0.7;font-size:0.9em;padding:12px 0">🤖 Synthesizing knowledge cards from ' + (msg.total || '') + ' queued responses…</div>';
					return;
				}
				if (msg.error) {
					resultsEl.innerHTML = '<div style="color:var(--vscode-errorForeground);font-size:0.9em;padding:8px 0">' + msg.error + '</div>';
					return;
				}
				const cards = msg.cards || [];
				if (!cards.length) {
					resultsEl.innerHTML = '<div style="opacity:0.6;font-size:0.9em;padding:8px 0">No cards extracted from this queue.</div>';
					return;
				}
				const rows = cards.map((c, i) => {
					const encodedTitle = c.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					const encodedContent = c.content.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					const encodedCategory = (c.category || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
					const sources = c.sourceIndices?.length ? ' <span style="opacity:0.5;font-size:0.8em;">from #' + c.sourceIndices.join(', #') + '</span>' : '';
					const renderedContent = renderMarkdownPreview(c.content);
					const isLong = c.content.length > 300;
					const previewContent = isLong ? renderMarkdownPreview(c.content.substring(0, 300) + '…') : renderedContent;
					return '<div class="distilled-card-row" data-title="' + encodedTitle + '" data-category="' + encodedCategory + '" data-content="' + encodedContent + '"' +
						' style="background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:12px;margin-bottom:10px;">' +
						'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
						'<div style="flex:1;min-width:0;">' +
						'<div style="font-size:0.8em;opacity:0.6;margin-bottom:4px;"><span class="category-badge ' + c.category + '">' + c.category + '</span>' +
						' &nbsp;' + Math.round(c.confidence * 100) + '% confidence' + sources + '</div>' +
						'<strong style="font-size:1em;">' + c.title + '</strong>' +
						'<div class="distilled-card-preview" style="margin:8px 0 0 0;font-size:0.85em;line-height:1.5;opacity:0.85;">' + previewContent + '</div>' +
						(isLong ? '<div class="distilled-card-full" style="display:none;margin:8px 0 0 0;font-size:0.85em;line-height:1.5;opacity:0.85;">' + renderedContent + '</div>' +
						'<button class="distilled-toggle-btn" style="background:none;border:none;color:var(--vscode-textLink-foreground);cursor:pointer;font-size:0.8em;padding:4px 0;margin-top:2px;">Show more</button>' : '') +
						'<p style="margin:4px 0 0 0;font-size:0.78em;opacity:0.5;"><em>💡 ' + (c.reasoning || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</em></p>' +
						'</div>' +
						'<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">' +
						'<button class="approve-card-btn" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 10px;font-size:0.82em;border-radius:4px;cursor:pointer;">✓ Add</button>' +
						'<button class="dismiss-distilled-btn" style="background:none;border:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);padding:3px 8px;font-size:0.78em;border-radius:4px;cursor:pointer;">✗ Skip</button>' +
						'</div>' +
						'</div></div>';
				}).join('');
				resultsEl.innerHTML =
					'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
					'<strong style="font-size:0.9em;">📚 ' + cards.length + ' card proposal' + (cards.length !== 1 ? 's' : '') + ' extracted</strong>' +
					'<button onclick="approveAllDistilled()" class="secondary" style="font-size:0.82em;padding:3px 10px;">Approve All</button>' +
					'</div>' + rows;
				return;
			}

		});

		function bulkDeleteKnowledgeCards() {
			if (bulkSelection.knowledge.size === 0) return;
			if (confirm('Delete ' + bulkSelection.knowledge.size + ' knowledge card(s)?')) {
				bulkSelection.knowledge.forEach(cardId => {
					vscode.postMessage({
						command: 'deleteKnowledgeCard',
						projectId: activeProjectId,
						cardId
					});
				});
				bulkSelection.knowledge.clear();
			}
		}

		function bulkSelectKnowledgeCards() {
			if (bulkSelection.knowledge.size === 0) return;
			bulkSelection.knowledge.forEach(cardId => {
				vscode.postMessage({
					command: 'toggleCardSelection',
					projectId: activeProjectId,
					cardId
				});
			});
			// Don't clear - let user see what was selected
		}

		function cancelCardEdit(cardId) {
			const viewEl = document.getElementById('card-view-' + cardId);
			const editEl = document.getElementById('card-edit-' + cardId);
			if (viewEl && editEl) {
				viewEl.style.display = 'block';
				editEl.style.display = 'none';
			}
			clearInlineCardDraft(cardId);
			setDraftProtectionReason('inline-card-' + cardId, false);
			setInteracting(false);
		}

		function deleteCard(cardId, btn) {
			setButtonLoading(btn, 'Deleting…');
			vscode.postMessage({
				command: 'deleteKnowledgeCard',
				projectId: activeProjectId,
				cardId
			});
		}

		function saveToKnowledge(cacheEntryId) {
			vscode.postMessage({
				command: 'saveToKnowledge',
				projectId: activeProjectId,
				cacheEntryId
			});
		}

		function saveToCache(cardId) {
			// This would save from cache - not implemented yet
			alert('Feature coming soon: Save explanations from cache as knowledge cards');
		}

		// ─── Interaction tracking ──────────────────────────────────
		// When the user is interacting with forms/inputs (add-TODO form,
		// title edits, notes), tell the extension to suppress full re-renders
		// so the form state isn't destroyed by background TODO progress updates.
		let _interacting = false;
		let _draftProtected = false;
		const _draftProtectionReasons = new Set();
		var _aiDraftPending = false; // True while waiting for AI draft response — prevents focusout from releasing suppression
		function setInteracting(state) {
			if (state === _interacting) return;
			_interacting = state;
			vscode.postMessage({ command: 'webviewInteracting', interacting: state });
		}

		function setDraftProtection(active) {
			if (active === _draftProtected) { return; }
			_draftProtected = active;
			vscode.postMessage({ command: 'webviewDraftState', hasDraft: active });
		}

		function setDraftProtectionReason(reason, active) {
			if (!reason) { return; }
			if (active) {
				_draftProtectionReasons.add(reason);
			} else {
				_draftProtectionReasons.delete(reason);
			}
			setDraftProtection(_draftProtectionReasons.size > 0);
		}

		function getInlineCardDrafts() {
			return getWebviewState().inlineCardDrafts || {};
		}

		function clearInlineCardDraft(cardId) {
			var drafts = { ...getInlineCardDrafts() };
			delete drafts[cardId];
			mergeWebviewState({ inlineCardDrafts: Object.keys(drafts).length ? drafts : null });
		}

		function persistInlineCardDraft(cardId) {
			if (!cardId) { return; }
			var viewEl = document.getElementById('card-view-' + cardId);
			var editEl = document.getElementById('card-edit-' + cardId);
			var titleEl = document.getElementById('card-title-editor-' + cardId);
			var editorEl = document.getElementById('card-editor-' + cardId);
			if (!viewEl || !editEl || !titleEl || !editorEl) { return; }
			var isVisible = editEl.style.display !== 'none';
			if (!isVisible) {
				clearInlineCardDraft(cardId);
				return;
			}
			var trackEl = document.getElementById('card-track-editor-' + cardId);
			var pinnedEl = document.getElementById('card-pinned-editor-' + cardId);
			var contextEl = document.getElementById('card-context-editor-' + cardId);
			var archivedEl = document.getElementById('card-archived-editor-' + cardId);
			var detailsEl = editEl.closest('details');
			var drafts = {
				...getInlineCardDrafts(),
				[cardId]: {
					title: titleEl.value || '',
					content: editorEl.value || '',
					trackToolUsage: !!trackEl?.checked,
					pinned: !!pinnedEl?.checked,
					includeInContext: !!contextEl?.checked,
					archived: !!archivedEl?.checked,
					detailsOpen: !!detailsEl?.open,
				}
			};
			mergeWebviewState({ inlineCardDrafts: drafts });
		}

		function restoreInlineCardDrafts() {
			var drafts = previousState.inlineCardDrafts || {};
			var restored = false;
			Object.keys(drafts).forEach(function(cardId) {
				var draft = drafts[cardId];
				if (!draft) { return; }
				var viewEl = document.getElementById('card-view-' + cardId);
				var editEl = document.getElementById('card-edit-' + cardId);
				var titleEl = document.getElementById('card-title-editor-' + cardId);
				var editorEl = document.getElementById('card-editor-' + cardId);
				if (!viewEl || !editEl || !titleEl || !editorEl) { return; }
				var detailsEl = editEl.closest('details');
				if (detailsEl && draft.detailsOpen) {
					detailsEl.setAttribute('open', '');
				}
				viewEl.style.display = 'none';
				editEl.style.display = 'block';
				titleEl.value = draft.title || '';
				editorEl.value = draft.content || '';
				var trackEl = document.getElementById('card-track-editor-' + cardId);
				var pinnedEl = document.getElementById('card-pinned-editor-' + cardId);
				var contextEl = document.getElementById('card-context-editor-' + cardId);
				var archivedEl = document.getElementById('card-archived-editor-' + cardId);
				if (trackEl) { trackEl.checked = !!draft.trackToolUsage; }
				if (pinnedEl) { pinnedEl.checked = !!draft.pinned; }
				if (contextEl) { contextEl.checked = !!draft.includeInContext; }
				if (archivedEl) { archivedEl.checked = !!draft.archived; }
				editorEl.style.height = 'auto';
				var contentHeight = Math.max(300, editorEl.scrollHeight + 24);
				editorEl.style.height = Math.min(contentHeight, window.innerHeight * 0.8) + 'px';
				setDraftProtectionReason('inline-card-' + cardId, true);
				restored = true;
			});
			if (restored) {
				setInteracting(true);
			}
		}

		function getInlineCardDraftId(target) {
			var id = target && target.id;
			if (!id) { return null; }
			var prefixes = [
				'card-title-editor-',
				'card-editor-',
				'card-track-editor-',
				'card-pinned-editor-',
				'card-context-editor-',
				'card-archived-editor-',
			];
			for (var i = 0; i < prefixes.length; i++) {
				if (id.startsWith(prefixes[i])) {
					return id.substring(prefixes[i].length);
				}
			}
			return null;
		}

		// Also suppress during inline title editing and notes editing
		function _isTrackedInput(el) {
			if (!el || !el.id) { return false; }
			return (
				el.id === 'newTodoTitle' ||
				el.id === 'newTodoDesc' ||
				el.id.startsWith('todo-title-edit-') ||
				el.id.startsWith('todo-desc-edit-') ||
				el.id.startsWith('todo-notes-') ||
				el.id.startsWith('cache-name-editor-') ||
				el.id.startsWith('cache-editor-') ||
				el.id.startsWith('card-title-editor-') ||
				el.id.startsWith('card-editor-') ||
				el.id === 'newProjectName' ||
				el.id === 'newCardTitle' ||
				el.id === 'newCardContent' ||
				el.id === 'contextGoals' ||
				el.id === 'contextConventions' ||
				el.id === 'contextKeyFiles' ||
				// Card canvas editor panel inputs
				el.id === 'editor-title' ||
				el.id === 'editor-content' ||
				el.id === 'editor-category' ||
				el.id === 'editor-tag-input' ||
				el.id === 'editor-custom-prompt'
			);
		}
		document.addEventListener('focusin', function(e) {
			if (_isTrackedInput(e.target)) {
				setInteracting(true);
			}
		});
		document.addEventListener('focusout', function(e) {
			if (_isTrackedInput(e.target)) {
				// Small delay to allow focus to move to another tracked element
				setTimeout(() => {
					// Don't release suppression while waiting for AI draft response
					if (_aiDraftPending) { return; }
					const active = document.activeElement;
					const stillEditing = _isTrackedInput(active);
					if (!stillEditing && !_draftProtected) {
						setInteracting(false);
					}
				}, 100);
			}
		});
		document.addEventListener('input', function(e) {
			var cardId = getInlineCardDraftId(e.target);
			if (cardId) {
				persistInlineCardDraft(cardId);
			}
		});
		document.addEventListener('change', function(e) {
			var cardId = getInlineCardDraftId(e.target);
			if (cardId) {
				persistInlineCardDraft(cardId);
			}
		});

		// Initialize tab from saved state or URL param
		const initialTab = previousState.currentTab || '${initialTab}';
		if (initialTab !== 'intelligence') {
			switchTab(initialTab, false); // Don't re-save on init
		}

		// Track expanded details elements
		const expandedItems = new Set(previousState.expandedItems || []);

		function saveExpandedState() {
			vscode.setState({ ...vscode.getState(), expandedItems: Array.from(expandedItems) });
		}

		// Restore expanded state for all details with data-expand-id
		document.querySelectorAll('details[data-expand-id]').forEach(details => {
			const id = details.getAttribute('data-expand-id');
			// Folders: default open unless user explicitly collapsed them
			const isFolder = id && id.startsWith('folder-');
			if (isFolder) {
				// Keep open unless explicitly in the collapsed set
				if (expandedItems.has(id + ':closed')) {
					details.removeAttribute('open');
				} else {
					details.setAttribute('open', '');
				}
			} else if (expandedItems.has(id)) {
				details.setAttribute('open', '');
			}
			// Listen for toggle events
			details.addEventListener('toggle', function() {
				if (isFolder) {
					// For folders: track closed state (they default open)
					if (this.open) {
						expandedItems.delete(id + ':closed');
					} else {
						expandedItems.add(id + ':closed');
					}
					saveExpandedState();
					return;
				}
				if (this.open) {
					expandedItems.add(id);
					if (id && id.startsWith('card-')) {
						var cardId = id.substring('card-'.length);
						var saved = previousState.cardViewScrollTops || {};
						var scrollTop = Number(saved[cardId]);
						if (Number.isFinite(scrollTop) && scrollTop > 0) {
							requestAnimationFrame(function() {
								var viewEl = document.getElementById('card-view-' + cardId);
								if (viewEl) { viewEl.scrollTop = scrollTop; }
							});
						}
					}
				} else {
					expandedItems.delete(id);
				}
				saveExpandedState();
			});
		});
		requestAnimationFrame(function() {
			restoreCardViewScrollTops();
		});

		// ─── Inline modal for input (shared across context menu and card buttons) ──────────
		const modalOverlay = document.createElement('div');
		modalOverlay.className = 'inline-modal-overlay';
		modalOverlay.setAttribute('role', 'dialog');
		modalOverlay.setAttribute('aria-modal', 'true');
		modalOverlay.innerHTML = \`
			<div class="inline-modal">
				<h3 id="inlineModalTitle"></h3>
				<div id="inlineModalHint" class="modal-hint"></div>
				<input id="inlineModalInput" type="text" />
				<div class="modal-buttons">
					<button class="secondary" id="inlineModalCancel">Cancel</button>
					<button id="inlineModalOk">OK</button>
				</div>
			</div>
		\`;
		document.body.appendChild(modalOverlay);

		// Focus trap for inline modal
		modalOverlay.addEventListener('keydown', function(e) {
			if (e.key !== 'Tab') return;
			const focusable = modalOverlay.querySelectorAll('input:not([style*="display: none"]), button, textarea, select, [tabindex]:not([tabindex="-1"])');
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey) {
				if (document.activeElement === first) { e.preventDefault(); last.focus(); }
			} else {
				if (document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		});

		function showInlineModal(title, hint, placeholder, okLabel) {
			return new Promise((resolve) => {
				document.getElementById('inlineModalTitle').textContent = title;
				document.getElementById('inlineModalHint').textContent = hint;
				const input = document.getElementById('inlineModalInput');
				input.value = '';
				input.style.display = '';
				input.placeholder = placeholder || '';
				document.getElementById('inlineModalOk').textContent = okLabel || 'OK';
				modalOverlay.classList.add('visible');
				setTimeout(() => input.focus(), 50);

				function cleanup() {
					modalOverlay.classList.remove('visible');
					document.getElementById('inlineModalOk').removeEventListener('click', onOk);
					document.getElementById('inlineModalCancel').removeEventListener('click', onCancel);
					input.removeEventListener('keydown', onKey);
				}
				function onOk() { cleanup(); resolve(input.value); }
				function onCancel() { cleanup(); resolve(null); }
				function onKey(e) {
					if (e.key === 'Enter') { onOk(); }
					if (e.key === 'Escape') { onCancel(); }
				}
				document.getElementById('inlineModalOk').addEventListener('click', onOk);
				document.getElementById('inlineModalCancel').addEventListener('click', onCancel);
				input.addEventListener('keydown', onKey);
			});
		}

		function showInlineConfirm(title, message, okLabel) {
			return new Promise((resolve) => {
				document.getElementById('inlineModalTitle').textContent = title;
				document.getElementById('inlineModalHint').textContent = message;
				const input = document.getElementById('inlineModalInput');
				input.style.display = 'none';
				const okBtn = document.getElementById('inlineModalOk');
				okBtn.textContent = okLabel || 'Delete';
				modalOverlay.classList.add('visible');
				setTimeout(() => okBtn.focus(), 50);

				function cleanup() {
					modalOverlay.classList.remove('visible');
					input.style.display = '';
					okBtn.removeEventListener('click', onOk);
					document.getElementById('inlineModalCancel').removeEventListener('click', onCancel);
					document.removeEventListener('keydown', onKey);
				}
				function onOk() { cleanup(); resolve(true); }
				function onCancel() { cleanup(); resolve(false); }
				function onKey(e) {
					if (e.key === 'Enter') { onOk(); }
					if (e.key === 'Escape') { onCancel(); }
				}
				okBtn.addEventListener('click', onOk);
				document.getElementById('inlineModalCancel').addEventListener('click', onCancel);
				document.addEventListener('keydown', onKey);
			});
		}

		// ─── Card Queue Functions ──────────────────────────────────
		function approveCandidate(candidateId) {
			if (!activeProjectId) { return; }
			vscode.postMessage({
				command: 'approveCandidate',
				projectId: activeProjectId,
				candidateId: candidateId
			});
		}

		function rejectCandidate(candidateId) {
			if (!activeProjectId) { return; }
			vscode.postMessage({
				command: 'rejectCandidate',
				projectId: activeProjectId,
				candidateId: candidateId
			});
		}

		function editAndApproveCandidate(candidateId) {
			if (!activeProjectId) { return; }
			vscode.postMessage({
				command: 'editAndApproveCandidate',
				projectId: activeProjectId,
				candidateId: candidateId
			});
		}

		function clearQueue() {
			if (!activeProjectId) { return; }
			vscode.postMessage({
				command: 'clearCardQueue',
				projectId: activeProjectId
			});
		}

		function toggleAllQueueItems(checked) {
			document.querySelectorAll('.queue-select-cb').forEach(function(cb) {
				cb.checked = checked;
				updateCandidateVisual(cb);
			});
		}

		function toggleCandidateSelection(indexOrCheckbox) {
			var checkbox;
			if (typeof indexOrCheckbox === 'number') {
				var all = document.querySelectorAll('.queue-select-cb');
				checkbox = all[indexOrCheckbox];
				if (!checkbox) { return; }
				checkbox.checked = !checkbox.checked;
			} else {
				checkbox = indexOrCheckbox;
			}
			updateCandidateVisual(checkbox);
			// Sync "Select all" checkbox state
			var allCbs = document.querySelectorAll('.queue-select-cb');
			var checkedCbs = document.querySelectorAll('.queue-select-cb:checked');
			var selectAllCb = document.getElementById('queue-select-all');
			if (selectAllCb) {
				selectAllCb.checked = allCbs.length > 0 && allCbs.length === checkedCbs.length;
				selectAllCb.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;
			}
		}

		function updateCandidateVisual(checkbox) {
			var card = checkbox.closest('.cache-item');
			if (card) {
				card.style.opacity = checkbox.checked ? '1' : '0.55';
				card.style.borderLeftColor = checkbox.checked
					? 'var(--vscode-panel-border)'
					: 'transparent';
			}
		}

		function distillQueue() {
			if (!activeProjectId) { return; }
			// Use tile selection Set if available, fall back to checkbox query
			var checked = _tileSelection.size > 0
				? Array.from(_tileSelection)
				: Array.from(document.querySelectorAll('.tile-select-cb:checked'))
					.map(function(cb) { return cb.getAttribute('data-id'); })
					.filter(Boolean);
			if (!checked.length) {
				const resultsEl = document.getElementById('distill-queue-results');
				if (resultsEl) { resultsEl.style.display = 'block'; resultsEl.innerHTML = '<div style="color:var(--vscode-errorForeground);font-size:0.9em;padding:8px 0">No items selected. Check at least one tile to distill.</div>'; }
				return;
			}
			const resultsEl = document.getElementById('distill-queue-results');
			if (resultsEl) {
				resultsEl.style.display = 'block';
				resultsEl.innerHTML = '<div style="opacity:0.7;font-size:0.9em;padding:12px 0">🤖 Extracting knowledge cards from ' + checked.length + ' selected item' + (checked.length !== 1 ? 's' : '') + '…</div>';
			}
			vscode.postMessage({ command: 'distillQueue', projectId: activeProjectId, candidateIds: checked });
		}

		function approveDistilledCard(title, category, content, rowEl) {
			if (!activeProjectId) { return; }
			vscode.postMessage({ command: 'approveDistilledCard', projectId: activeProjectId, title, category, content });
			// Fade out the card row
			if (rowEl) { rowEl.style.opacity = '0.4'; rowEl.style.pointerEvents = 'none'; }
		}

		function approveAllDistilled() {
			if (!activeProjectId) { return; }
			const rows = document.querySelectorAll('.distilled-card-row:not([data-approved])');
			rows.forEach(function(row) {
				const title = row.dataset.title;
				const category = row.dataset.category;
				const content = row.dataset.content;
				if (title && content) {
					vscode.postMessage({ command: 'approveDistilledCard', projectId: activeProjectId, title, category, content });
					row.dataset.approved = '1';
					row.style.opacity = '0.4';
					row.style.pointerEvents = 'none';
				}
			});
		}

		// ─── Knowledge Subtab Switching ──────────────────────────
		var _activeKnowledgeSubtab = 'workbench';

		function switchKnowledgeSubtab(name) {
			_activeKnowledgeSubtab = name;
			// Update subtab tabs
			document.querySelectorAll('.knowledge-subtab').forEach(function(tab) {
				tab.classList.toggle('active', tab.getAttribute('data-subtab') === name);
			});
			// Show/hide subtab content
			document.querySelectorAll('.knowledge-subtab-content').forEach(function(content) {
				content.style.display = 'none';
			});
			var target = document.getElementById('subtab-' + name);
			if (target) { target.style.display = 'block'; }
			// Persist subtab state
			vscode.setState({ ...vscode.getState(), knowledgeSubtab: name });
		}

		// Restore persisted subtab on load
		if (previousState.knowledgeSubtab) {
			requestAnimationFrame(function() { switchKnowledgeSubtab(previousState.knowledgeSubtab); });
		}

		// ─── Workbench: Filter & Search ───────────────────────────

		// Active filter tags (managed by tag autocomplete)
		var _filterTags = [];

		function applyWorkbenchFilter() {
			var grid = document.getElementById('workbench-tile-grid');
			if (!grid) { return; }

			// ── Gather filter state ──
			var enabledKinds = {};
			document.querySelectorAll('#workbench-filter-bar input[data-filter-kind]').forEach(function(cb) {
				enabledKinds[cb.getAttribute('data-filter-kind')] = cb.checked;
			});

			var searchInput = document.getElementById('workbench-search');
			var searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();

			var categorySelect = document.getElementById('workbench-category-filter');
			var categoryFilter = categorySelect ? categorySelect.value : 'all';

			var pinnedOnlyCb = document.getElementById('workbench-pinned-only');
			var pinnedOnly = pinnedOnlyCb ? pinnedOnlyCb.checked : false;

			var showArchivedCb = document.getElementById('workbench-show-archived');
			var showArchived = showArchivedCb ? showArchivedCb.checked : false;

			var sortSelect = document.getElementById('workbench-sort');
			var sortMode = sortSelect ? sortSelect.value : 'newest';

			// ── Filter pass ──
			var totalCount = 0;
			var visibleCount = 0;
			var tiles = Array.from(grid.querySelectorAll('.card-tile'));

			tiles.forEach(function(tile) {
				totalCount++;
				var kind = tile.getAttribute('data-tile-type') || 'card';
				var visible = enabledKinds[kind] !== false;

				// Category filter
				if (visible && categoryFilter !== 'all') {
					var tileCat = tile.getAttribute('data-tile-category') || '';
					visible = tileCat === categoryFilter;
				}

				// Pinned only
				if (visible && pinnedOnly) {
					visible = tile.getAttribute('data-tile-pinned') === 'true';
				}

				// Archived: hide unless opted in
				if (visible && !showArchived) {
					if (tile.getAttribute('data-tile-archived') === 'true') {
						visible = false;
					}
				}

				// Tag filter (AND logic)
				if (visible && _filterTags.length > 0) {
					var tileTags = (tile.getAttribute('data-tile-tags') || '').toLowerCase().split(',').filter(Boolean);
					for (var i = 0; i < _filterTags.length; i++) {
						if (tileTags.indexOf(_filterTags[i].toLowerCase()) < 0) {
							visible = false;
							break;
						}
					}
				}

				// Text search — searches title, snippet, tags, and category
				if (visible && searchTerm) {
					var title = tile.querySelector('.card-tile-title');
					var snippet = tile.querySelector('.card-tile-snippet');
					var titleText = (title ? title.textContent : '').toLowerCase();
					var snippetText = (snippet ? snippet.textContent : '').toLowerCase();
					var tagsText = (tile.getAttribute('data-tile-tags') || '').toLowerCase();
					var catText = (tile.getAttribute('data-tile-category') || '').toLowerCase();
					visible = titleText.indexOf(searchTerm) >= 0
						|| snippetText.indexOf(searchTerm) >= 0
						|| tagsText.indexOf(searchTerm) >= 0
						|| catText.indexOf(searchTerm) >= 0;
				}

				tile.style.display = visible ? '' : 'none';
				if (visible) { visibleCount++; }
			});

			// ── Sort pass ──
			var visibleTiles = tiles.filter(function(t) { return t.style.display !== 'none'; });
			visibleTiles.sort(function(a, b) {
				// Pinned always first
				var aPinned = a.getAttribute('data-tile-pinned') === 'true' ? 1 : 0;
				var bPinned = b.getAttribute('data-tile-pinned') === 'true' ? 1 : 0;
				if (aPinned !== bPinned) { return bPinned - aPinned; }

				if (sortMode === 'newest' || sortMode === 'oldest') {
					var aTs = parseInt(a.getAttribute('data-tile-timestamp') || '0', 10);
					var bTs = parseInt(b.getAttribute('data-tile-timestamp') || '0', 10);
					return sortMode === 'newest' ? bTs - aTs : aTs - bTs;
				}
				if (sortMode === 'az' || sortMode === 'za') {
					var aTitle = (a.querySelector('.card-tile-title') || {}).textContent || '';
					var bTitle = (b.querySelector('.card-tile-title') || {}).textContent || '';
					var cmp = aTitle.localeCompare(bTitle);
					return sortMode === 'za' ? -cmp : cmp;
				}
				return 0;
			});

			// Re-append in sorted order (hidden tiles stay at end)
			var hiddenTiles = tiles.filter(function(t) { return t.style.display === 'none'; });
			visibleTiles.concat(hiddenTiles).forEach(function(t) {
				grid.appendChild(t);
			});

			// ── Update result count ──
			var countEl = document.getElementById('workbench-result-count');
			if (countEl) {
				if (visibleCount < totalCount) {
					countEl.textContent = visibleCount + ' of ' + totalCount;
				} else {
					countEl.textContent = totalCount + ' items';
				}
			}

			// ── Show/hide clear filters button ──
			var hasActiveFilter = searchTerm
				|| categoryFilter !== 'all'
				|| pinnedOnly
				|| showArchived
				|| _filterTags.length > 0
				|| sortMode !== 'newest'
				|| Object.keys(enabledKinds).some(function(k) { return !enabledKinds[k]; });
			var clearBtn = document.getElementById('workbench-clear-filters');
			if (clearBtn) {
				clearBtn.style.display = hasActiveFilter ? '' : 'none';
			}

			// ── Persist filter state ──
			vscode.setState({ ...vscode.getState(), workbenchFilter: {
				enabledKinds: enabledKinds,
				searchTerm: searchInput ? searchInput.value : '',
				category: categoryFilter,
				tags: _filterTags.slice(),
				pinnedOnly: pinnedOnly,
				showArchived: showArchived,
				sortMode: sortMode,
			}});
		}

		function clearWorkbenchFilters() {
			// Reset kind checkboxes
			document.querySelectorAll('#workbench-filter-bar input[data-filter-kind]').forEach(function(cb) {
				cb.checked = true;
			});
			// Reset search
			var searchInput = document.getElementById('workbench-search');
			if (searchInput) { searchInput.value = ''; }
			// Reset category
			var categorySelect = document.getElementById('workbench-category-filter');
			if (categorySelect) { categorySelect.value = 'all'; }
			// Reset tags
			_filterTags = [];
			renderFilterTagChips();
			// Reset status toggles
			var pinnedCb = document.getElementById('workbench-pinned-only');
			if (pinnedCb) { pinnedCb.checked = false; }
			var archivedCb = document.getElementById('workbench-show-archived');
			if (archivedCb) { archivedCb.checked = false; }
			// Reset sort
			var sortSelect = document.getElementById('workbench-sort');
			if (sortSelect) { sortSelect.value = 'newest'; }
			applyWorkbenchFilter();
		}

		// ─── Workbench: Tag Autocomplete ──────────────────────────

		function collectAllTags() {
			var tagSet = {};
			document.querySelectorAll('.card-tile').forEach(function(tile) {
				var raw = tile.getAttribute('data-tile-tags') || '';
				raw.split(',').forEach(function(t) {
					var trimmed = t.trim();
					if (trimmed) { tagSet[trimmed.toLowerCase()] = trimmed; }
				});
			});
			return Object.values(tagSet);
		}

		function showTagSuggestions(value) {
			var container = document.getElementById('tag-suggestions');
			if (!container) { return; }
			var term = (value || '').toLowerCase().trim();
			if (!term) { container.innerHTML = ''; container.style.display = 'none'; return; }

			var allTags = collectAllTags();
			var matches = allTags.filter(function(t) {
				return t.toLowerCase().indexOf(term) >= 0 && _filterTags.indexOf(t) < 0;
			}).slice(0, 8);

			if (matches.length === 0) { container.innerHTML = ''; container.style.display = 'none'; return; }

			container.innerHTML = matches.map(function(tag) {
				return '<div class="tag-suggestion-item" onmousedown="addFilterTag(\\'' + escapeHtml(tag).replace(/'/g, "\\\\'") + '\\')">' + escapeHtml(tag) + '</div>';
			}).join('');
			container.style.display = 'block';
		}

		function hideTagSuggestions() {
			var container = document.getElementById('tag-suggestions');
			if (container) { container.innerHTML = ''; container.style.display = 'none'; }
		}

		function handleTagInputKey(event) {
			if (event.key === 'Enter') {
				event.preventDefault();
				var input = document.getElementById('workbench-tag-input');
				var val = input ? input.value.trim() : '';
				if (val && _filterTags.indexOf(val) < 0) {
					_filterTags.push(val);
					renderFilterTagChips();
					applyWorkbenchFilter();
				}
				if (input) { input.value = ''; }
				hideTagSuggestions();
			} else if (event.key === 'Escape') {
				hideTagSuggestions();
			}
		}

		function addFilterTag(tag) {
			if (_filterTags.indexOf(tag) < 0) {
				_filterTags.push(tag);
				renderFilterTagChips();
				applyWorkbenchFilter();
			}
			var input = document.getElementById('workbench-tag-input');
			if (input) { input.value = ''; }
			hideTagSuggestions();
		}

		function removeFilterTag(tag) {
			_filterTags = _filterTags.filter(function(t) { return t !== tag; });
			renderFilterTagChips();
			applyWorkbenchFilter();
		}

		function renderFilterTagChips() {
			var container = document.getElementById('filter-tag-chips');
			if (!container) { return; }
			container.innerHTML = _filterTags.map(function(tag) {
				return '<span class="filter-tag-chip">' + escapeHtml(tag) + '<span class="filter-tag-remove" onclick="removeFilterTag(\\'' + escapeHtml(tag).replace(/'/g, "\\\\'") + '\\')">✕</span></span>';
			}).join('');
		}

		// ─── Workbench: Restore persisted filter state ────────────
		(function restoreWorkbenchFilter() {
			var saved = previousState.workbenchFilter;
			if (!saved) {
				// No saved state — still apply default sort (newest first)
				requestAnimationFrame(function() { applyWorkbenchFilter(); });
				return;
			}
			requestAnimationFrame(function() {
				// Restore kind checkboxes
				if (saved.enabledKinds) {
					document.querySelectorAll('#workbench-filter-bar input[data-filter-kind]').forEach(function(cb) {
						var kind = cb.getAttribute('data-filter-kind');
						if (kind && saved.enabledKinds[kind] !== undefined) {
							cb.checked = saved.enabledKinds[kind];
						}
					});
				}
				// Restore search
				if (saved.searchTerm) {
					var searchInput = document.getElementById('workbench-search');
					if (searchInput) { searchInput.value = saved.searchTerm; }
				}
				// Restore category
				if (saved.category) {
					var categorySelect = document.getElementById('workbench-category-filter');
					if (categorySelect) { categorySelect.value = saved.category; }
				}
				// Restore tags
				if (saved.tags && saved.tags.length > 0) {
					_filterTags = saved.tags.slice();
					renderFilterTagChips();
				}
				// Restore pinned only
				if (saved.pinnedOnly) {
					var pinnedCb = document.getElementById('workbench-pinned-only');
					if (pinnedCb) { pinnedCb.checked = true; }
				}
				// Restore show archived
				if (saved.showArchived) {
					var archivedCb = document.getElementById('workbench-show-archived');
					if (archivedCb) { archivedCb.checked = true; }
				}
				// Restore sort
				if (saved.sortMode) {
					var sortSelect = document.getElementById('workbench-sort');
					if (sortSelect) { sortSelect.value = saved.sortMode; }
				}
				applyWorkbenchFilter();
			});
		})();

		(function restoreKnowledgeCardsFilter() {
			var saved = previousState.knowledgeCardsFilter;
			requestAnimationFrame(function() {
				if (saved) {
					var searchInput = document.getElementById('knowledge-cards-search');
					if (searchInput && saved.searchTerm) { searchInput.value = saved.searchTerm; }
					var categorySelect = document.getElementById('knowledge-cards-category-filter');
					if (categorySelect && saved.category) { categorySelect.value = saved.category; }
					var pinnedOnlyCb = document.getElementById('knowledge-cards-pinned-only');
					if (pinnedOnlyCb) { pinnedOnlyCb.checked = !!saved.pinnedOnly; }
					var showArchivedCb = document.getElementById('knowledge-cards-show-archived');
					if (showArchivedCb) { showArchivedCb.checked = saved.showArchived !== false; }
					var sortSelect = document.getElementById('knowledge-cards-sort');
					if (sortSelect && saved.sortMode) { sortSelect.value = saved.sortMode; }
				}
				applyKnowledgeCardsFilter();
			});
		})();

		(function restoreSessionsFilter() {
			var saved = previousState.sessionsFilter;
			requestAnimationFrame(function() {
				if (saved) {
					var searchInput = document.getElementById('sessions-search');
					if (searchInput && saved.searchTerm) { searchInput.value = saved.searchTerm; }
					var originSelect = document.getElementById('sessions-origin-filter');
					if (originSelect && saved.origin) { originSelect.value = saved.origin; }
					var statusSelect = document.getElementById('sessions-status-filter');
					if (statusSelect && saved.status) { statusSelect.value = saved.status; }
					var projectSelect = document.getElementById('sessions-project-filter');
					if (projectSelect && saved.project) { projectSelect.value = saved.project; }
					var queuedOnlyCb = document.getElementById('sessions-queued-only');
					if (queuedOnlyCb) { queuedOnlyCb.checked = !!saved.queuedOnly; }
					var sortSelect = document.getElementById('sessions-sort');
					if (sortSelect && saved.sortMode) { sortSelect.value = saved.sortMode; }
				}
				applySessionsFilter();
			});
		})();

		// Close tag suggestions when clicking outside
		document.addEventListener('click', function(e) {
			var tagFilter = document.getElementById('workbench-tag-filter');
			if (tagFilter && !tagFilter.contains(e.target)) {
				hideTagSuggestions();
			}
		});

		// ─── Workbench: Staging Area ──────────────────────────────
		function updateStagingArea() {
			var stagingItems = document.getElementById('staging-items');
			var stagingActions = document.getElementById('staging-actions');
			var stagingCount = document.getElementById('staging-count');
			if (!stagingItems) { return; }

			var selectedIds = Array.from(_tileSelection);
			if (selectedIds.length === 0) {
				stagingItems.innerHTML = '<div class="staging-empty">Select items from above to start mixing &amp; matching</div>';
				if (stagingActions) { stagingActions.style.display = 'none'; }
				if (stagingCount) { stagingCount.textContent = 'Drop items here or select with checkboxes'; }
				return;
			}

			if (stagingCount) { stagingCount.textContent = selectedIds.length + ' item' + (selectedIds.length !== 1 ? 's' : '') + ' staged'; }
			if (stagingActions) { stagingActions.style.display = 'flex'; }

			// Build mini-cards for staging area
			var html = '';
			selectedIds.forEach(function(id) {
				var sourceTile = document.querySelector('.card-tile[data-tile-id="' + id + '"]');
				if (!sourceTile) { return; }
				var kind = sourceTile.getAttribute('data-tile-type') || 'card';
				var titleEl = sourceTile.querySelector('.card-tile-title');
				var title = titleEl ? titleEl.textContent.trim() : 'Untitled';
				var kindBadge = sourceTile.querySelector('.kind-badge');
				var kindLabel = kindBadge ? kindBadge.textContent.trim() : kind;

				html += '<div class="staging-item" data-staging-id="' + id + '">'
					+ '<span class="staging-item-kind">' + escapeHtml(kindLabel) + '</span>'
					+ '<span class="staging-item-title">' + escapeHtml(title) + '</span>'
					+ '<button class="staging-item-remove" onclick="removeStagingItem(\\'' + id + '\\')" title="Remove">✕</button>'
					+ '</div>';
			});
			stagingItems.innerHTML = html;
		}

		function removeStagingItem(id) {
			_tileSelection.delete(id);
			// Uncheck corresponding checkbox
			var cb = document.querySelector('.tile-select-cb[data-id="' + id + '"]');
			if (cb) { cb.checked = false; }
			var tile = document.querySelector('.card-tile[data-tile-id="' + id + '"]');
			if (tile) { tile.classList.remove('selected'); }
			updateMultiSelectBar();
			updateStagingArea();
		}

		// ─── Card Canvas: Tile Selection & Multi-Select ───────────
		var _tileSelection = new Set();
		var _editorState = { open: false, tileId: null, tileType: null, mode: null, baseUpdated: null, pendingSave: false };

		function updateMultiSelectBar() {
			var bar = document.getElementById('multi-select-bar');
			var countEl = document.getElementById('select-count');
			if (!bar) { return; }
			if (_tileSelection.size > 0) {
				bar.classList.add('visible');
				if (countEl) { countEl.textContent = _tileSelection.size + ' selected'; }
			} else {
				bar.classList.remove('visible');
			}
			// Also update staging area in workbench
			updateStagingArea();
		}

		function clearTileSelection() {
			_tileSelection.clear();
			document.querySelectorAll('.tile-select-cb').forEach(function(cb) { cb.checked = false; });
			document.querySelectorAll('.card-tile.selected').forEach(function(t) { t.classList.remove('selected'); });
			updateMultiSelectBar();
		}

		// Delegated change handler for tile checkboxes
		document.addEventListener('change', function(event) {
			var target = event.target;
			if (!target) { return; }

			if (target.classList && target.classList.contains('tile-select-cb')) {
				var id = target.getAttribute('data-id');
				var tile = target.closest('.card-tile');
				if (target.checked) {
					_tileSelection.add(id);
					if (tile) { tile.classList.add('selected'); }
				} else {
					_tileSelection.delete(id);
					if (tile) { tile.classList.remove('selected'); }
				}
				updateMultiSelectBar();
				return;
			}

			// Legacy queue checkbox handling
			if (target.id === 'queue-select-all') {
				toggleAllQueueItems(target.checked);
				return;
			}
			if (target.classList && target.classList.contains('queue-select-cb')) {
				toggleCandidateSelection(target);
				return;
			}
		});

		// ─── Card Canvas: Rich Editor Panel ───────────────────────
		var _editorPreviewTimer = null;

		function getEditorTags() {
			var tagsContainer = document.getElementById('editor-tags');
			if (!tagsContainer) { return []; }
			var tags = [];
			tagsContainer.querySelectorAll('.tag-pill').forEach(function(p) {
				var text = p.childNodes[0] ? p.childNodes[0].textContent.trim() : '';
				if (text) { tags.push(text); }
			});
			return tags;
		}

		function persistEditorDraft() {
			var panel = document.getElementById('card-editor-panel');
			if (!panel) { return; }
			if (!_editorState.open && !panel.classList.contains('visible')) {
				mergeWebviewState({ editorDraft: null });
				return;
			}
			var titleInput = document.getElementById('editor-title');
			var categorySelect = document.getElementById('editor-category');
			var contentArea = document.getElementById('editor-content');
			var promptInput = document.getElementById('editor-custom-prompt');
			var globalCb = document.getElementById('editor-global-cb');
			var statusEl = document.getElementById('editor-status');
			var panelTitle = document.getElementById('editor-panel-title');
			if (!titleInput || !categorySelect || !contentArea) { return; }
			mergeWebviewState({
				editorDraft: {
					editorState: { ..._editorState },
					panelTitle: panelTitle ? panelTitle.textContent || '' : '',
					title: titleInput.value || '',
					category: categorySelect.value || 'note',
					content: contentArea.value || '',
					tags: getEditorTags(),
					customPrompt: promptInput ? promptInput.value || '' : '',
					isGlobal: !!globalCb?.checked,
					status: statusEl ? statusEl.textContent || '' : '',
				}
			});
		}

		function clearEditorDraft() {
			mergeWebviewState({ editorDraft: null });
		}

		function restoreEditorDraft() {
			var draft = previousState.editorDraft;
			if (!draft || !draft.editorState || !draft.editorState.open) { return; }
			var panel = document.getElementById('card-editor-panel');
			var titleInput = document.getElementById('editor-title');
			var categorySelect = document.getElementById('editor-category');
			var contentArea = document.getElementById('editor-content');
			var panelTitle = document.getElementById('editor-panel-title');
			var statusEl = document.getElementById('editor-status');
			var promptContainer = document.getElementById('editor-custom-prompt-container');
			var promptInput = document.getElementById('editor-custom-prompt');
			var tagsContainer = document.getElementById('editor-tags');
			var globalToggle = document.getElementById('editor-global-toggle');
			var globalCb = document.getElementById('editor-global-cb');
			if (!panel || !titleInput || !categorySelect || !contentArea) { return; }

			_editorState = {
				open: !!draft.editorState.open,
				tileId: draft.editorState.tileId || null,
				tileType: draft.editorState.tileType || null,
				mode: draft.editorState.mode || null,
				baseUpdated: draft.editorState.baseUpdated || null,
				pendingSave: false,
			};

			titleInput.value = draft.title || '';
			categorySelect.value = draft.category || 'note';
			contentArea.value = draft.content || '';
			if (panelTitle) { panelTitle.textContent = draft.panelTitle || 'Edit Card'; }
			if (statusEl) { statusEl.textContent = draft.status || ''; }
			if (promptInput) { promptInput.value = draft.customPrompt || ''; }
			if (promptContainer) {
				promptContainer.style.display = _editorState.mode === 'ai-synthesize' ? '' : 'none';
			}
			if (tagsContainer) {
				var tagInput = tagsContainer.querySelector('input');
				tagsContainer.querySelectorAll('.tag-pill').forEach(function(p) { p.remove(); });
				(draft.tags || []).forEach(function(tag) { insertTagPill(tagsContainer, tag, tagInput); });
			}
			if (globalToggle && globalCb) {
				if (_editorState.tileType !== 'queue' && _editorState.tileId) {
					globalToggle.style.display = '';
					globalCb.checked = !!draft.isGlobal;
				} else {
					globalToggle.style.display = 'none';
				}
			}

			panel.classList.add('visible');
			if (_editorState.tileId) {
				var tile = document.querySelector('.card-tile[data-tile-id="' + _editorState.tileId + '"]');
				if (tile) { tile.classList.add('editing'); }
			}
			setDraftProtectionReason('card-editor-panel', true);
			setInteracting(true);
			updateEditorPreview();
		}

		function wireEditorDraftPersistence() {
			['editor-title', 'editor-content', 'editor-custom-prompt'].forEach(function(id) {
				var el = document.getElementById(id);
				if (el) { el.addEventListener('input', persistEditorDraft); }
			});
			['editor-category', 'editor-global-cb'].forEach(function(id) {
				var el = document.getElementById(id);
				if (el) { el.addEventListener('change', persistEditorDraft); }
			});
		}

		function openTileInEditor(tileId, tileType) {
			if (!activeProjectId) { return; }
			_editorState = { open: true, tileId: tileId, tileType: tileType, mode: 'edit', baseUpdated: null, pendingSave: false };
			setDraftProtectionReason('card-editor-panel', true);
			persistEditorDraft();

			// Highlight the active tile
			document.querySelectorAll('.card-tile.editing').forEach(function(t) { t.classList.remove('editing'); });
			var tile = document.querySelector('.card-tile[data-tile-id="' + tileId + '"]');
			if (tile) { tile.classList.add('editing'); }

			// Request full data from backend
			vscode.postMessage({
				command: 'getTileData',
				projectId: activeProjectId,
				tileId: tileId,
				tileType: tileType
			});
		}

		// Called by message handler when backend sends tile data
		function populateEditor(data) {
			var panel = document.getElementById('card-editor-panel');
			var titleInput = document.getElementById('editor-title');
			var categorySelect = document.getElementById('editor-category');
			var contentArea = document.getElementById('editor-content');
			var panelTitle = document.getElementById('editor-panel-title');
			var statusEl = document.getElementById('editor-status');
			var promptContainer = document.getElementById('editor-custom-prompt-container');
			if (!panel || !titleInput || !categorySelect || !contentArea) { return; }

			_editorState.baseUpdated = data.baseUpdated || null;
			_editorState.pendingSave = false;

			// Hide custom prompt field for regular edits
			if (promptContainer && _editorState.mode !== 'ai-synthesize') { promptContainer.style.display = 'none'; }

			titleInput.value = data.title || '';
			categorySelect.value = data.category || 'note';
			contentArea.value = data.content || '';
			if (panelTitle) { panelTitle.textContent = data.isQueue ? 'Edit Queue Item' : 'Edit Knowledge Card'; }
			if (statusEl) { statusEl.textContent = ''; }

			// Populate tags
			var tagsContainer = document.getElementById('editor-tags');
			if (tagsContainer) {
				var tagInput = tagsContainer.querySelector('input');
				tagsContainer.querySelectorAll('.tag-pill').forEach(function(p) { p.remove(); });
				(data.tags || []).forEach(function(tag) { insertTagPill(tagsContainer, tag, tagInput); });
			}

			// Populate tool calls
			var tcContainer = document.getElementById('editor-toolcalls-container');
			if (tcContainer) { tcContainer.innerHTML = data.toolCallsHtml || ''; }

			// Populate source material
			var srcContainer = document.getElementById('editor-source-container');
			if (srcContainer) { srcContainer.innerHTML = data.sourceHtml || ''; }

			// Populate anchors
			var ancContainer = document.getElementById('editor-anchors-container');
			if (ancContainer) { ancContainer.innerHTML = data.anchorsHtml || ''; }

			// Show/hide global toggle (only for saved cards, not queue items)
			var globalToggle = document.getElementById('editor-global-toggle');
			var globalCb = document.getElementById('editor-global-cb');
			if (globalToggle && globalCb) {
				if (!data.isQueue) {
					globalToggle.style.display = '';
					globalCb.checked = !!data.isGlobal;
				} else {
					globalToggle.style.display = 'none';
				}
			}

			// Show panel
			panel.classList.add('visible');
			setDraftProtectionReason('card-editor-panel', true);
			updateEditorPreview();
			persistEditorDraft();
			titleInput.focus();
		}

		function closeCardEditor() {
			setDraftProtectionReason('card-editor-panel', false);
			var panel = document.getElementById('card-editor-panel');
			if (panel) { panel.classList.remove('visible'); }
			document.querySelectorAll('.card-tile.editing').forEach(function(t) { t.classList.remove('editing'); });
			// Reset custom prompt field
			var promptContainer = document.getElementById('editor-custom-prompt-container');
			var promptInput = document.getElementById('editor-custom-prompt');
			if (promptContainer) { promptContainer.style.display = 'none'; }
			if (promptInput) { promptInput.value = ''; }
			// Reset global toggle
			var globalToggle = document.getElementById('editor-global-toggle');
			if (globalToggle) { globalToggle.style.display = 'none'; }
			_editorState = { open: false, tileId: null, tileType: null, mode: null, baseUpdated: null, pendingSave: false };
			_aiDraftPending = false;
			clearEditorDraft();
			setInteracting(false);
		}

		function updateEditorPreview() {
			clearTimeout(_editorPreviewTimer);
			_editorPreviewTimer = setTimeout(function() {
				var content = document.getElementById('editor-content');
				var preview = document.getElementById('editor-preview');
				if (!content || !preview) { return; }
				preview.innerHTML = renderMarkdownPreview(content.value);
				persistEditorDraft();
			}, 300);
		}

		function renderMarkdownPreview(text) {
			if (!text || !text.trim()) { return '<p style="opacity:0.4;font-style:italic;">Live preview will appear here…</p>'; }
			// Lightweight markdown → HTML
			var html = text
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
				// Code blocks
				.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
				// Inline code
				.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
				// Headings
				.replace(/^### (.+)$/gm, '<h3>$1</h3>')
				.replace(/^## (.+)$/gm, '<h2>$1</h2>')
				.replace(/^# (.+)$/gm, '<h1>$1</h1>')
				// Bold + italic
				.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>')
				.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
				.replace(/\\*(.+?)\\*/g, '<em>$1</em>')
				// Links
				.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
				// Unordered lists
				.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>')
				// Line breaks → paragraphs (simple)
				.replace(/\\n\\n/g, '</p><p>')
				.replace(/\\n/g, '<br>');
			return '<p>' + html + '</p>';
		}

		function saveCardFromEditor() {
			if (!activeProjectId) { return; }
			var titleInput = document.getElementById('editor-title');
			var categorySelect = document.getElementById('editor-category');
			var contentArea = document.getElementById('editor-content');
			if (!titleInput || !categorySelect || !contentArea) { return; }

			var tags = getEditorTags();

			var statusEl = document.getElementById('editor-status');
			if (statusEl) { statusEl.textContent = 'Saving…'; }

			// Compose/merge/synthesize mode: no existing tileId, create a new card
			if (!_editorState.tileId && (_editorState.mode === 'compose' || _editorState.mode === 'ai-synthesize')) {
				vscode.postMessage({
					command: 'addKnowledgeCard',
					projectId: activeProjectId,
					title: titleInput.value,
					content: contentArea.value,
					category: categorySelect.value,
					tags: tags
				});
				clearEditorDraft();
				_editorState = { open: false, tileId: null, tileType: null, mode: 'view', baseUpdated: null, pendingSave: false };
				var panel = document.getElementById('card-editor-panel');
				if (panel) { panel.classList.remove('visible'); }
				return;
			}

			if (!_editorState.tileId) { return; }

			if (_editorState.tileType === 'queue') {
				vscode.postMessage({
					command: 'approveCandidateWithEdits',
					projectId: activeProjectId,
					candidateId: _editorState.tileId,
					title: titleInput.value,
					category: categorySelect.value,
					content: contentArea.value,
					tags: tags
				});
				closeCardEditor();
			} else {
				_editorState.pendingSave = true;
				persistEditorDraft();
				vscode.postMessage({
					command: 'editKnowledgeCard',
					projectId: activeProjectId,
					cardId: _editorState.tileId,
					title: titleInput.value,
					category: categorySelect.value,
					content: contentArea.value,
					tags: tags,
					baseUpdated: _editorState.baseUpdated || undefined
				});
				return;
			}
		}

		function aiDraftFromEditor() {
			if (!activeProjectId) { return; }
			var statusEl = document.getElementById('editor-status');
			if (statusEl) { statusEl.textContent = '✨ Generating AI draft…'; }

			// Suppress dashboard re-renders while waiting for AI response
			_aiDraftPending = true;
			setInteracting(true);

			// Show custom prompt field if not already visible
			var promptContainer = document.getElementById('editor-custom-prompt-container');
			if (promptContainer) { promptContainer.style.display = ''; }

			var selectedIds = Array.from(_tileSelection);
			persistEditorDraft();
			vscode.postMessage({
				command: 'synthesizeCard',
				projectId: activeProjectId,
				candidateIds: selectedIds.length > 0 ? selectedIds : (_editorState.tileId ? [_editorState.tileId] : []),
				currentTitle: document.getElementById('editor-title')?.value || '',
				currentContent: document.getElementById('editor-content')?.value || '',
				customPrompt: (document.getElementById('editor-custom-prompt')?.value || '').trim()
			});
		}

		// ─── Card Canvas: Tags Editor ─────────────────────────────
		function addEditorTag(value) {
			var tag = (value || '').trim();
			if (!tag) { return; }
			var container = document.getElementById('editor-tags');
			var input = document.getElementById('editor-tag-input');
			if (!container || !input) { return; }
			// Check duplicates
			var existing = [];
			container.querySelectorAll('.tag-pill').forEach(function(p) {
				existing.push((p.childNodes[0]?.textContent || '').trim().toLowerCase());
			});
			if (existing.includes(tag.toLowerCase())) { return; }
			insertTagPill(container, tag, input);
			persistEditorDraft();
		}

		function insertTagPill(container, tag, beforeEl) {
			var pill = document.createElement('span');
			pill.className = 'tag-pill';
			pill.innerHTML = tag + '<span class="tag-remove" onclick="removeEditorTag(this)">×</span>';
			container.insertBefore(pill, beforeEl);
		}

		function removeEditorTag(el) {
			if (el && el.parentElement) {
				el.parentElement.remove();
				persistEditorDraft();
			}
		}

		// ─── Card Canvas: Multi-Select Actions ────────────────────
		function composeFromSelected() {
			if (_tileSelection.size === 0) { return; }
			_editorState = { open: true, tileId: null, tileType: 'compose', mode: 'compose', baseUpdated: null, pendingSave: false };
			setDraftProtectionReason('card-editor-panel', true);
			persistEditorDraft();
			vscode.postMessage({
				command: 'getCompositionData',
				projectId: activeProjectId,
				selectedIds: Array.from(_tileSelection)
			});
		}

		function aiSynthesizeSelected() {
			if (_tileSelection.size === 0 || !activeProjectId) { return; }
			// Open editor panel with prompt input — don't fire LLM yet, let user type a prompt first
			_editorState = { open: true, tileId: null, tileType: 'compose', mode: 'ai-synthesize', baseUpdated: null, pendingSave: false };
			setDraftProtectionReason('card-editor-panel', true);
			var panel = document.getElementById('card-editor-panel');
			if (panel) { panel.classList.add('visible'); }
			var titleInput = document.getElementById('editor-title');
			var contentArea = document.getElementById('editor-content');
			var statusEl = document.getElementById('editor-status');
			var panelTitle = document.getElementById('editor-panel-title');
			var promptContainer = document.getElementById('editor-custom-prompt-container');
			var promptInput = document.getElementById('editor-custom-prompt');
			if (titleInput) { titleInput.value = ''; }
			if (contentArea) { contentArea.value = ''; }
			if (promptInput) { promptInput.value = ''; }
			if (panelTitle) { panelTitle.textContent = 'AI Synthesize (' + _tileSelection.size + ' items)'; }
			if (promptContainer) { promptContainer.style.display = ''; }
			if (statusEl) { statusEl.textContent = 'Enter a custom prompt (optional) then click ✨ AI Draft to generate'; }
			updateEditorPreview();
			persistEditorDraft();
		}

		function dismissSelected() {
			if (_tileSelection.size === 0 || !activeProjectId) { return; }
			vscode.postMessage({
				command: 'bulkRejectCandidates',
				projectId: activeProjectId,
				candidateIds: Array.from(_tileSelection)
			});
			_tileSelection.clear();
			updateMultiSelectBar();
		}

		function bulkQuickSave() {
			if (_tileSelection.size === 0 || !activeProjectId) { return; }
			vscode.postMessage({
				command: 'bulkQuickSave',
				projectId: activeProjectId,
				candidateIds: Array.from(_tileSelection)
			});
			_tileSelection.clear();
			updateMultiSelectBar();
		}

		// ─── Card Health: Merge Duplicate Pair ────────────────────
		function mergeHealthDuplicates(cardAId, cardBId) {
			if (!activeProjectId || !cardAId || !cardBId) { return; }
			vscode.postMessage({
				command: 'mergeHealthDuplicates',
				projectId: activeProjectId,
				cardAId: cardAId,
				cardBId: cardBId
			});
		}

		// ─── Workbench: Merge Selected Cards ──────────────────────
		function mergeSelectedCards() {
			if (_tileSelection.size < 2 || !activeProjectId) { return; }
			// Gather kinds for each selected item
			var items = [];
			_tileSelection.forEach(function(id) {
				var tile = document.querySelector('.card-tile[data-tile-id="' + id + '"]');
				var kind = tile ? tile.getAttribute('data-tile-type') : 'card';
				items.push({ id: id, kind: kind });
			});
			vscode.postMessage({
				command: 'mergeWorkbenchItems',
				projectId: activeProjectId,
				items: items
			});
		}

		// Listen for editor population messages from backend
		window.addEventListener('message', function(event) {
			var msg = event.data;
			if (msg.command === 'populateEditor') {
				_aiDraftPending = false; // AI draft response arrived — release the guard
				populateEditor(msg.data);
			}
			if (msg.command === 'switchToSubtab' && msg.subtab) {
				switchKnowledgeSubtab(msg.subtab);
			}
			if (msg.command === 'aiDraftProgress') {
				var statusEl = document.getElementById('editor-status');
				if (!statusEl) { return; }
				if (msg.phase === 'calling-model') {
					statusEl.innerHTML = '<span class="ai-progress-spinner"></span> ' + (msg.detail || 'Connecting to model…');
				} else if (msg.phase === 'streaming') {
					var chars = msg.chars ? ' (' + msg.chars + ' chars received)' : '';
					statusEl.innerHTML = '<span class="ai-progress-spinner"></span> Receiving AI response' + chars + '…';
				} else if (msg.phase === 'parsing') {
					statusEl.innerHTML = '<span class="ai-progress-spinner"></span> ' + (msg.detail || 'Parsing response…');
				}
			}
			if (msg.command === 'aiDraftResult') {
				var titleInput = document.getElementById('editor-title');
				var categorySelect = document.getElementById('editor-category');
				var contentArea = document.getElementById('editor-content');
				var statusEl = document.getElementById('editor-status');
				if (msg.data) {
					if (msg.data.title && titleInput) { titleInput.value = msg.data.title; }
					if (msg.data.category && categorySelect) { categorySelect.value = msg.data.category; }
					if (msg.data.content && contentArea) { contentArea.value = msg.data.content; }
					if (msg.data.tags) {
						var tagsContainer = document.getElementById('editor-tags');
						var tagInput = document.getElementById('editor-tag-input');
						if (tagsContainer && tagInput) {
							tagsContainer.querySelectorAll('.tag-pill').forEach(function(p) { p.remove(); });
							msg.data.tags.forEach(function(t) { insertTagPill(tagsContainer, t, tagInput); });
						}
					}
					updateEditorPreview();
					persistEditorDraft();
				}
				if (statusEl) {
					if (msg.data) {
						statusEl.textContent = '✨ AI draft applied';
					} else {
						statusEl.textContent = '⚠ AI draft failed' + (msg.error ? ': ' + msg.error : '');
					}
				}
			}
			if (msg.command === 'knowledgeCardSaveResult') {
				var statusEl = document.getElementById('editor-status');
				_editorState.pendingSave = false;
				if (msg.success) {
					if (typeof msg.updated === 'number') { _editorState.baseUpdated = msg.updated; }
					closeCardEditor();
					return;
				}
				if (statusEl) {
					statusEl.textContent = msg.message || (msg.conflict ? 'Card changed in the background. Review and save again.' : 'Save failed.');
				}
				persistEditorDraft();
				setInteracting(true);
			}
		});

		function toggleCollapsible(button) {
			const icon = button.querySelector('.toggle-icon');
			const content = button.parentElement.querySelector('.collapsible-content');
			if (!content) { return; }
			
			if (content.style.display === 'none') {
				content.style.display = 'block';
				icon.textContent = '▼';
				button.innerHTML = button.innerHTML.replace('Show', 'Hide');
			} else {
				content.style.display = 'none';
				icon.textContent = '▶';
				button.innerHTML = button.innerHTML.replace('Hide', 'Show');
			}
		}

		// Make functions globally available for inline onclick handlers
		window.toggleAllQueueItems = toggleAllQueueItems;
		window.toggleCandidateSelection = toggleCandidateSelection;
		window.approveCandidate = approveCandidate;
		window.rejectCandidate = rejectCandidate;
		window.editAndApproveCandidate = editAndApproveCandidate;
		window.clearQueue = clearQueue;
		window.distillQueue = distillQueue;
		window.approveDistilledCard = approveDistilledCard;
		window.approveAllDistilled = approveAllDistilled;
		window.toggleCollapsible = toggleCollapsible;
		// Card canvas globals
		window.openTileInEditor = openTileInEditor;
		window.closeCardEditor = closeCardEditor;
		window.saveCardFromEditor = saveCardFromEditor;
		window.aiDraftFromEditor = aiDraftFromEditor;
		window.updateEditorPreview = updateEditorPreview;
		window.addEditorTag = addEditorTag;
		window.toggleEditorGlobal = toggleEditorGlobal;
		window.composeFromSelected = composeFromSelected;
		window.aiSynthesizeSelected = aiSynthesizeSelected;
		window.dismissSelected = dismissSelected;
		window.bulkQuickSave = bulkQuickSave;
		window.clearTileSelection = clearTileSelection;
		window.removeEditorTag = removeEditorTag;
		// Workbench globals
		window.switchKnowledgeSubtab = switchKnowledgeSubtab;
		window.applyWorkbenchFilter = applyWorkbenchFilter;
		window.applyKnowledgeCardsFilter = applyKnowledgeCardsFilter;
		window.applySessionsFilter = applySessionsFilter;
		window.clearSessionsFilters = clearSessionsFilters;
		window.bulkAssignTrackedSessions = bulkAssignTrackedSessions;
		window.bulkDismissTrackedSessions = bulkDismissTrackedSessions;
		window.bulkForgetTrackedSessions = bulkForgetTrackedSessions;
		window.clearKnowledgeCardsFilters = clearKnowledgeCardsFilters;
		window.removeStagingItem = removeStagingItem;
		window.mergeSelectedCards = mergeSelectedCards;
		window.mergeHealthDuplicates = mergeHealthDuplicates;

		// ─── Keyboard Shortcuts ────────────────────────────────────
		document.addEventListener('keydown', function(e) {
			// Don't trigger shortcuts when typing in inputs/textareas
			var tag = (document.activeElement || {}).tagName || '';
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }

			// Ctrl+K / Cmd+K → focus search in current tab
			if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
				e.preventDefault();
				var searchInput = document.querySelector('.tab-content:not([style*=\"display: none\"]) .search-input');
				if (searchInput) { searchInput.focus(); searchInput.select(); }
				return;
			}

			// Ctrl+Shift+K / Cmd+Shift+K → toggle selection of all visible cards
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
				e.preventDefault();
				if (activeProjectId) { uncheckAllCards(); }
				return;
			}

			// Ctrl+N / Cmd+N → add card (if on knowledge tab)
			if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
				var knowledgeTab = document.getElementById('tab-knowledge');
				if (knowledgeTab && knowledgeTab.style.display !== 'none') {
					e.preventDefault();
					showAddCardForm();
					return;
				}
			}

			// 1-5 → switch tabs (when no modifier)
			if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
				var tabMap = { '1': 'intelligence', '2': 'knowledge', '3': 'sessions', '4': 'context', '5': 'settings' };
				if (tabMap[e.key]) {
					e.preventDefault();
					switchTab(tabMap[e.key]);
				}
			}
		});

		// ─── Custom Workflow Functions ──────────────────────────────
		function showAddWorkflowForm() {
			var form = document.getElementById('workflow-form');
			if (!form) return;
			// Reset form
			document.getElementById('wf-edit-id').value = '';
			document.getElementById('wf-name').value = '';
			document.getElementById('wf-prompt').value = '';
			document.getElementById('wf-trigger').value = 'manual';
			document.getElementById('wf-output').value = 'create-card';
			document.getElementById('wf-target-card').value = '';
			document.getElementById('wf-target-row').style.display = 'none';
			var maxItemsEl = document.getElementById('wf-maxitems');
			if (maxItemsEl) maxItemsEl.value = '20';
			var skipEl = document.getElementById('wf-skip');
			if (skipEl) skipEl.value = '';
			var filterEl = document.getElementById('wf-filter');
			if (filterEl) filterEl.value = '';
			form.style.display = 'block';
			document.getElementById('btn-add-workflow').style.display = 'none';
			setInteracting(true);
			document.getElementById('wf-name').focus();
		}

		function hideWorkflowForm() {
			var form = document.getElementById('workflow-form');
			if (form) form.style.display = 'none';
			var btn = document.getElementById('btn-add-workflow');
			if (btn) btn.style.display = '';
			setInteracting(false);
		}

		function workflowOutputNeedsTarget(outputAction) {
			return outputAction === 'update-card'
				|| outputAction === 'append-collector'
				|| outputAction === 'update-card-template'
				|| outputAction === 'append-collector-template';
		}

		function workflowOutputUsesAi(outputAction) {
			return outputAction === 'create-card'
				|| outputAction === 'update-card'
				|| outputAction === 'append-collector';
		}

		function wfOutputChanged() {
			var output = document.getElementById('wf-output').value;
			var targetRow = document.getElementById('wf-target-row');
			if (targetRow) {
				targetRow.style.display = workflowOutputNeedsTarget(output) ? 'block' : 'none';
			}
			var helpEl = document.getElementById('wf-output-help');
			if (helpEl) {
				helpEl.textContent = workflowOutputUsesAi(output)
					? 'AI actions send the resolved template to the model. Template actions save the rendered template directly.'
					: 'Template actions skip the model call and save the resolved template directly. Update and append actions require a target card.';
			}
		}

		function insertWfVar(varName) {
			var textarea = document.getElementById('wf-prompt');
			if (!textarea) return;
			var start = textarea.selectionStart;
			var end = textarea.selectionEnd;
			var text = textarea.value;
			var insertion = '{{' + varName + '}}';
			textarea.value = text.substring(0, start) + insertion + text.substring(end);
			textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
			textarea.focus();
		}

		function saveWorkflow() {
			var name = (document.getElementById('wf-name').value || '').trim();
			var promptTemplate = (document.getElementById('wf-prompt').value || '').trim();
			var trigger = document.getElementById('wf-trigger').value;
			var outputAction = document.getElementById('wf-output').value;
			var targetCardId = document.getElementById('wf-target-card').value || '';
			var editId = document.getElementById('wf-edit-id').value;
			var maxItemsEl = document.getElementById('wf-maxitems');
			var maxItems = maxItemsEl ? parseInt(maxItemsEl.value) || 20 : 20;
			var skipEl = document.getElementById('wf-skip');
			var skipPattern = skipEl ? skipEl.value.trim() : '';
			var filterEl = document.getElementById('wf-filter');
			var triggerFilter = filterEl ? filterEl.value.trim() : '';

			if (!name) { alert('Please enter a workflow name.'); return; }
			if (!promptTemplate) { alert('Please enter a prompt template.'); return; }
			if (workflowOutputNeedsTarget(outputAction) && !targetCardId) {
				alert('Please select a target card for this output action.'); return;
			}

			if (editId) {
				vscode.postMessage({
					command: 'updateWorkflow',
					workflowId: editId,
					name: name,
					promptTemplate: promptTemplate,
					trigger: trigger,
					outputAction: outputAction,
					targetCardId: targetCardId,
					maxItems: maxItems,
					skipPattern: skipPattern,
					triggerFilter: triggerFilter
				});
			} else {
				vscode.postMessage({
					command: 'addWorkflow',
					name: name,
					promptTemplate: promptTemplate,
					trigger: trigger,
					outputAction: outputAction,
					targetCardId: targetCardId,
					maxItems: maxItems,
					skipPattern: skipPattern,
					triggerFilter: triggerFilter
				});
			}
			hideWorkflowForm();
		}

		function editWorkflow(workflowId) {
			var item = document.querySelector('.workflow-item[data-workflow-id="' + workflowId + '"]');
			if (!item) return;
			showAddWorkflowForm();
			document.getElementById('wf-edit-id').value = workflowId;
			// Read from data attributes
			document.getElementById('wf-name').value = item.getAttribute('data-wf-name') || '';
			document.getElementById('wf-prompt').value = item.getAttribute('data-wf-prompt') || '';
			document.getElementById('wf-trigger').value = item.getAttribute('data-wf-trigger') || 'manual';
			document.getElementById('wf-output').value = item.getAttribute('data-wf-output') || 'create-card';
			wfOutputChanged();
			document.getElementById('wf-target-card').value = item.getAttribute('data-wf-target') || '';
			var maxItemsEl = document.getElementById('wf-maxitems');
			if (maxItemsEl) maxItemsEl.value = item.getAttribute('data-wf-maxitems') || '20';
			var skipEl = document.getElementById('wf-skip');
			if (skipEl) skipEl.value = item.getAttribute('data-wf-skip') || '';
			var filterEl = document.getElementById('wf-filter');
			if (filterEl) filterEl.value = item.getAttribute('data-wf-filter') || '';
		}

		function deleteWorkflow(workflowId) {
			if (confirm('Delete this workflow?')) {
				vscode.postMessage({ command: 'deleteWorkflow', workflowId: workflowId });
			}
		}

		function toggleWorkflow(workflowId, enabled) {
			vscode.postMessage({ command: 'toggleWorkflow', workflowId: workflowId, enabled: enabled });
		}

		function runWorkflow(workflowId) {
			vscode.postMessage({ command: 'runWorkflow', workflowId: workflowId });
		}

		// Handle workflow messages from host
		window.addEventListener('message', function(event) {
			var msg = event.data;
			if (msg.command === 'workflowRunning') {
				var btn = document.querySelector('.workflow-item[data-workflow-id="' + msg.workflowId + '"] button[onclick*="runWorkflow"]');
				if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
			}
			if (msg.command === 'workflowResult') {
				var btn = document.querySelector('.workflow-item[data-workflow-id="' + msg.workflowId + '"] button[onclick*="runWorkflow"]');
				if (btn) { btn.textContent = '▶'; btn.disabled = false; }
			}
			if (msg.command === 'populateWorkflowForm' && msg.workflow) {
				var wf = msg.workflow;
				document.getElementById('wf-edit-id').value = wf.id || '';
				document.getElementById('wf-name').value = wf.name || '';
				document.getElementById('wf-prompt').value = wf.promptTemplate || '';
				document.getElementById('wf-trigger').value = wf.trigger || 'manual';
				document.getElementById('wf-output').value = wf.outputAction || 'create-card';
				wfOutputChanged();
				document.getElementById('wf-target-card').value = wf.targetCardId || '';
				var maxItemsEl = document.getElementById('wf-maxitems');
				if (maxItemsEl) maxItemsEl.value = String(wf.maxItems || 20);
				var skipEl = document.getElementById('wf-skip');
				if (skipEl) skipEl.value = wf.skipPattern || '';
				var filterEl = document.getElementById('wf-filter');
				if (filterEl) filterEl.value = wf.triggerFilter || '';
			}
		});

		wireAddCardDraftPersistence();
		wireEditorDraftPersistence();
		restoreAddCardDraft();
		restoreEditorDraft();
		restoreInlineCardDrafts();

		// ─── Context menu on knowledge card text selection ──────────
		(function setupCardContextMenu() {
			// Create hidden context menu element
			const menu = document.createElement('div');
			menu.className = 'card-context-menu';
			menu.innerHTML = \`
				<div class="card-context-menu-item" data-action="askQuestion">💬 Ask Question about Selection</div>
				<div class="card-context-menu-item" data-action="refineSelection">🔄 Refine Selection with AI</div>
				<div class="card-context-menu-sep"></div>
				<div class="card-context-menu-item" data-action="replaceSelection">✏️ Replace Selection</div>
				<div class="card-context-menu-item" data-action="deleteSelection">🗑️ Delete Selection</div>
				<div class="card-context-menu-sep"></div>
				<div class="card-context-menu-item" data-action="newCard">📝 Create Card from Selection</div>
				<div class="card-context-menu-item" data-action="newCardAI">🤖 Create Card with AI from Selection</div>
			\`;
			document.body.appendChild(menu);

			let contextCardId = null;
			let contextSelectedText = '';

			// Show menu on mouseup over a card-view div when text is selected
			document.addEventListener('mouseup', function(e) {
				// Don't trigger on clicks inside the context menu or modal
				if (menu.contains(e.target) || modalOverlay.contains(e.target)) return;

				const sel = window.getSelection();
				const text = sel?.toString().trim();
				if (!text) return;

				// Check if selection is inside a card view element
				const cardView = e.target.closest?.('[id^="card-view-"]');
				if (!cardView) return;

				contextCardId = cardView.id.replace('card-view-', '');
				contextSelectedText = text;

				menu.style.left = e.clientX + 'px';
				menu.style.top = e.clientY + 'px';
				menu.classList.add('visible');
			});

			// Handle menu item clicks
			menu.addEventListener('click', async function(e) {
				const item = e.target.closest('.card-context-menu-item');
				if (!item) return;
				const action = item.getAttribute('data-action');
				menu.classList.remove('visible');

				if (action === 'replaceSelection') {
					const preview = contextSelectedText.length > 60 ? contextSelectedText.substring(0, 60) + '…' : contextSelectedText;
					const replacement = await showInlineModal('Replace Selection', 'Replace: "' + preview + '"', 'Enter replacement text…', 'Replace');
					if (replacement !== null) {
						vscode.postMessage({
							command: 'replaceCardSelection',
							projectId: activeProjectId,
							selectedText: contextSelectedText,
							sourceCardId: contextCardId,
							replacement: replacement
						});
					}

				} else if (action === 'deleteSelection') {
					const preview = contextSelectedText.length > 80 ? contextSelectedText.substring(0, 80) + '…' : contextSelectedText;
					const confirmed = await showInlineConfirm('Delete Selection', 'Remove this text from the card? "' + preview + '"', 'Delete');
					if (confirmed) {
						vscode.postMessage({
							command: 'deleteCardSelection',
							projectId: activeProjectId,
							selectedText: contextSelectedText,
							sourceCardId: contextCardId,
							confirmed: true
						});
					}

				} else if (action === 'refineSelection') {
					const instruction = await showInlineModal('Refine Selection with AI', 'What should the AI do with this selection?', 'e.g., Summarize, Expand, Fix grammar, Rewrite as bullets…', 'Refine');
					if (instruction) {
						vscode.postMessage({
							command: 'refineCardSelection',
							projectId: activeProjectId,
							selectedText: contextSelectedText,
							sourceCardId: contextCardId,
							instruction: instruction
						});
					}

				} else if (action === 'newCard') {
					const title = await showInlineModal('Create Card from Selection', 'The selected text will become the card content.', 'Enter a title for the new card…', 'Create');
					if (title) {
						vscode.postMessage({
							command: 'createCardFromSelection',
							projectId: activeProjectId,
							selectedText: contextSelectedText,
							sourceCardId: contextCardId,
							title: title
						});
					}

				} else if (action === 'askQuestion') {
					vscode.postMessage({
						command: 'askAboutSelection',
						projectId: activeProjectId,
						selectedText: contextSelectedText,
						sourceCardId: contextCardId
					});

				} else if (action === 'newCardAI') {
					vscode.postMessage({
						command: 'createCardFromSelectionAI',
						projectId: activeProjectId,
						selectedText: contextSelectedText,
						sourceCardId: contextCardId
					});
				}
			});

			// Hide menu on click elsewhere or scroll
			document.addEventListener('mousedown', function(e) {
				if (!menu.contains(e.target) && !modalOverlay.contains(e.target)) {
					menu.classList.remove('visible');
				}
			});
			document.addEventListener('scroll', function() { menu.classList.remove('visible'); }, true);
		})();
	</script>`;
}
