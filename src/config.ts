import * as vscode from 'vscode';

/**
 * Centralized configuration management for ContextManager settings.
 * Provides type-safe access to extension configuration with defaults.
 */
export class ConfigurationManager {
	private static readonly SECTION = 'contextManager';

	/**
	 * Get a configuration value with type safety.
	 */
	private static get<T>(key: string, defaultValue: T): T {
		const config = vscode.workspace.getConfiguration(this.SECTION);
		return config.get<T>(key, defaultValue);
	}

	/**
	 * Set a configuration value.
	 */
	private static async set(key: string, value: any, target?: vscode.ConfigurationTarget): Promise<void> {
		const config = vscode.workspace.getConfiguration(this.SECTION);
		await config.update(key, value, target || vscode.ConfigurationTarget.Global);
	}

	// ─── General Settings ───────────────────────────────────────────

	static get showStatusBar(): boolean {
		return this.get('showStatusBar', true);
	}

	static get confirmDelete(): boolean {
		return this.get('confirmDelete', true);
	}

	static get autoSelectKnowledgeCards(): boolean {
		return this.get('autoSelectKnowledgeCards', false);
	}

	static get maxKnowledgeCardsInContext(): number {
		return this.get('maxKnowledgeCardsInContext', 5);
	}

	static get cacheExpiration(): number {
		return this.get('cacheExpiration', 30);
	}

	static get enableContextByDefault(): boolean {
		return this.get('enableContextByDefault', true);
	}

	// ─── Chat Settings ──────────────────────────────────────────────

	static get chatIncludeCopilotInstructions(): boolean {
		return this.get('chat.includeCopilotInstructions', true);
	}


	// ─── TODO Settings ──────────────────────────────────────────────

	static get todoAutoUpdateStatus(): boolean {
		return this.get('todo.autoUpdateStatus', true);
	}

	// ─── Explanation Settings ───────────────────────────────────────

	static get explanationExpandContext(): boolean {
		return this.get('explanation.expandContext', true);
	}

	static get explanationIncludeReferences(): boolean {
		return this.get('explanation.includeReferences', true);
	}

	// ─── Dashboard Settings ─────────────────────────────────────────

	static get dashboardDefaultTab(): string {
		return this.get('dashboard.defaultTab', 'overview');
	}

	// ─── Notification Settings ──────────────────────────────────────

	static get notificationsShowProgress(): boolean {
		return this.get('notifications.showProgress', true);
	}

	// ─── Context Settings ───────────────────────────────────────────

	static get contextAutoDeselectAfterUse(): boolean {
		return this.get('context.autoDeselectAfterUse', false);
	}

	// ─── Experimental Settings ─────────────────────────────────────

	static get experimentalProposedApi(): boolean {
		return this.get('experimental.enableProposedApi', false);
	}

	// ─── Search Settings ──────────────────────────────────────────

	/** Whether BM25 full-text search (SQLite FTS5) is enabled. */
	static get searchEnableFTS(): boolean {
		return this.get('search.enableFTS', true);
	}

	/** Max knowledge cards returned by #searchCards (1–20, default 5). */
	static get searchMaxCardResults(): number {
		return this.get('search.maxCardResults', 5);
	}

	/** Max results returned by #search cross-entity search (1–50, default 10). */
	static get searchMaxSearchResults(): number {
		return this.get('search.maxSearchResults', 10);
	}

	/** Snippet context tokens around match highlights (8–64, default 16). */
	static get searchSnippetTokens(): number {
		return this.get('search.snippetTokens', 16);
	}

	// ─── Subagent Settings ─────────────────────────────────────────

	/** Whether the subagent tool is enabled for delegating complex tasks. */
	static get subagentEnabled(): boolean {
		return this.get('subagent.enabled', true);
	}

	/** Maximum tool-calling iterations a subagent can perform (10–200, default 50). */
	static get subagentMaxIterations(): number {
		return Math.max(10, Math.min(200, this.get('subagent.maxIterations', 50)));
	}

	/** Preferred model family for subagent loops (empty = use default). */
	static get subagentModelFamily(): string {
		return this.get('subagent.modelFamily', '').trim();
	}

	/**
	 * When true (default), the save/read/search cache and save knowledge card tools
	 * run silently with just a status line — no confirmation dialog interrupts the session.
	 * Set to false to show a confirmation prompt before each operation.
	 */
	static get toolsBackgroundMode(): boolean {
		return this.get('tools.backgroundMode', true);
	}

	// ─── Git Settings ─────────────────────────────────────────────

	/** Base branch for computing changed files / branch-scoped commits. Empty = auto-detect main/master. */
	static get branchBaseBranch(): string {
		return this.get('branch.baseBranch', '').trim();
	}

	/** Update the base branch setting. */
	static async setBranchBaseBranch(value: string): Promise<void> {
		await this.set('branch.baseBranch', value, vscode.ConfigurationTarget.Workspace);
	}

	// ─── Project Intelligence Settings ─────────────────────────────

	/** Enable tiered injection of conventions + tool hints into prompts. */
	static get intelligenceEnableTieredInjection(): boolean {
		return this.get('intelligence.enableTieredInjection', true);
	}

	/** Inject learned intelligence into ALL chat participants (not just @ctx). */
	static get intelligenceInjectIntoAllParticipants(): boolean {
		return this.get('intelligence.injectIntoAllParticipants', true);
	}

	/** Token budget for Tier 1 (always-injected) learnings. */
	static get intelligenceTier1MaxTokens(): number {
		return this.get('intelligence.tier1MaxTokens', 800);
	}

	/** Token budget for Tier 2 (task-relevant) learnings. */
	static get intelligenceTier2MaxTokens(): number {
		return this.get('intelligence.tier2MaxTokens', 800);
	}

	/** Hard cap on characters injected per prompt (0 = unlimited). */
	static get intelligenceInjectionMaxChars(): number {
		return this.get('intelligence.injectionMaxChars', 0);
	}

	/** @deprecated Per-prompt injection removed — intelligence via copilot-instructions.md + #ctx tool. */
	static get intelligenceMinPromptLength(): number {
		return 0;
	}

	/** Inject conventions into non-@ctx prompts. */
	static get intelligenceInjectConventions(): boolean {
		return this.get('intelligence.injectConventions', true);
	}

	/** Inject working notes into non-@ctx prompts. */
	static get intelligenceInjectWorkingNotes(): boolean {
		return this.get('intelligence.injectWorkingNotes', true);
	}

	/** Inject tool hints into non-@ctx prompts. */
	static get intelligenceInjectToolHints(): boolean {
		return this.get('intelligence.injectToolHints', true);
	}

	/** Inject knowledge cards into non-@ctx prompts. */
	static get intelligenceInjectKnowledgeCards(): boolean {
		return this.get('intelligence.injectKnowledgeCards', true);
	}

	/** Enable file-based staleness tracking on working notes and knowledge cards. */
	static get intelligenceEnableStalenessTracking(): boolean {
		return this.get('intelligence.enableStalenessTracking', true);
	}

	/** Age threshold (days) for flagging knowledge cards as stale in the dashboard. */
	static get intelligenceStalenessAgeDays(): number {
		return Math.max(7, this.get('intelligence.stalenessAgeDays', 30));
	}

	/**
	 * Enable the auto-learning pipeline.
	 * When true, every chat interaction is analyzed post-hoc for:
	 *  - Tool hints (search fail→success patterns)
	 *  - Working notes (file co-access relationships)
	 *  - Conventions (pattern statements in responses)
	 * All items saved as 'inferred' for user review.
	 */
	static get intelligenceAutoLearn(): boolean {
		return this.get('intelligence.autoLearn', true);
	}

	/** Use a cheap LLM call for convention/note extraction instead of regex-only. */
	static get autoLearnUseLLM(): boolean {
		return this.get('intelligence.autoLearn.useLLM', true);
	}

	/** Preferred model family for auto-learn LLM extraction (empty = use default). */
	static get autoLearnModelFamily(): string {
		return this.get('intelligence.autoLearn.modelFamily', '').trim();
	}

	/** Suppress a signal category after N user discards. 0 = never suppress. */
	static get autoLearnDiscardThreshold(): number {
		return Math.max(0, this.get('intelligence.autoLearn.discardThreshold', 5));
	}

	/** Show auto-learn results inline in chat responses. */
	static get autoLearnShowInChat(): boolean {
		return this.get('intelligence.autoLearn.showInChat', true);
	}

	/** Max inferred working notes before oldest are evicted. */
	static get autoLearnMaxWorkingNotes(): number {
		return this.get('intelligence.autoLearn.maxWorkingNotes', 30);
	}

	/** Max tool hints before oldest are evicted. */
	static get autoLearnMaxToolHints(): number {
		return this.get('intelligence.autoLearn.maxToolHints', 20);
	}

	/** Max inferred conventions before oldest are evicted. */
	static get autoLearnMaxConventions(): number {
		return this.get('intelligence.autoLearn.maxConventions', 15);
	}

	/** Extract tool hints from search fail→success patterns. */
	static get autoLearnExtractToolHints(): boolean {
		return this.get('intelligence.autoLearn.extractToolHints', true);
	}

	/** Extract working notes from file co-access patterns. */
	static get autoLearnExtractWorkingNotes(): boolean {
		return this.get('intelligence.autoLearn.extractWorkingNotes', true);
	}

	/** Extract conventions from response text patterns. */
	static get autoLearnExtractConventions(): boolean {
		return this.get('intelligence.autoLearn.extractConventions', true);
	}

	/** Max tool hints extracted per single chat interaction. */
	static get autoLearnHintsPerRun(): number {
		return Math.max(0, Math.min(10, this.get('intelligence.autoLearn.hintsPerRun', 3)));
	}

	/** Max working notes extracted per single chat interaction. */
	static get autoLearnNotesPerRun(): number {
		return Math.max(0, Math.min(10, this.get('intelligence.autoLearn.notesPerRun', 2)));
	}

	/** Max conventions extracted per single chat interaction. */
	static get autoLearnConventionsPerRun(): number {
		return Math.max(0, Math.min(5, this.get('intelligence.autoLearn.conventionsPerRun', 1)));
	}

	/** Auto-expire inferred items after N days (0 = never). */
	static get autoLearnExpiryDays(): number {
		return Math.max(0, this.get('intelligence.autoLearn.expiryDays', 0));
	}

	// ─── Auto-Capture Settings ─────────────────────────────────────

	/** Enable auto-capture of observations from all chat interactions. */
	static get autoCaptureEnabled(): boolean {
		return this.get('autoCapture.enabled', true);
	}

	/** Run LLM extraction on non-@ctx interactions to learn conventions. */
	static get autoCaptureLearnFromAll(): boolean {
		return this.get('autoCapture.learnFromAllParticipants', true);
	}

	/** Maximum observations to store in the circular buffer. */
	static get autoCaptureMaxObservations(): number {
		return Math.max(10, Math.min(200, this.get('autoCapture.maxObservations', 50)));
	}

	// ─── Auto-Distill Settings ──────────────────────────────────────

	/** Enable automatic distillation at compaction checkpoints. */
	static get autoDistillEnabled(): boolean {
		return this.get('autoDistill.enabled', true);
	}

	/** Minimum minutes between automatic distillation runs. */
	static get autoDistillIntervalMinutes(): number {
		return Math.max(5, this.get('autoDistill.intervalMinutes', 30));
	}

	/** Jaccard similarity threshold for deduplication (0.0-1.0). */
	static get dedupThreshold(): number {
		return Math.max(0.5, Math.min(1.0, this.get('autoDistill.dedupThreshold', 0.8)));
	}

	// ─── Save-as-Card Settings ──────────────────────────────────────

	/** Enable smart merge detection when saving cards (checks for semantic overlap). */
	static get smartMergeEnabled(): boolean {
		return this.get('saveAsCard.smartMerge', true);
	}

	/** Enable save-as-card follow-up buttons after @ctx commands. */
	static get saveAsCardFollowupsEnabled(): boolean {
		return this.get('saveAsCard.showFollowups', true);
	}

	// ─── Card Queue Settings ────────────────────────────────────────

	/** Enable automatic detection of card-worthy content and queue for review. */
	static get cardQueueEnabled(): boolean {
		return this.get('cardQueue.enabled', true);
	}

	/** Minimum response length (chars) to queue a candidate for review. */
	static get cardQueueMinResponseLength(): number {
		return Math.max(50, this.get('cardQueue.minResponseLength', 300));
	}

	/** Maximum number of candidates in the queue before oldest are dropped. */
	static get cardQueueMaxSize(): number {
		return Math.max(5, Math.min(100, this.get('cardQueue.maxSize', 30)));
	}

	/** Number of candidates to process per LLM call during distillation. */
	static get cardQueueDistillBatchSize(): number {
		return Math.max(1, Math.min(10, this.get('cardQueue.distillBatchSize', 2)));
	}

	/** Maximum cards to extract per distill run. */
	static get cardQueueMaxCardsPerDistill(): number {
		return Math.max(1, Math.min(30, this.get('cardQueue.maxCardsPerDistill', 12)));
	}

	/** Lines of code captured per anchor stub. */
	static get contextStubLines(): number {
		return Math.max(1, Math.min(30, this.get('context.stubLines', 5)));
	}

	// ─── Prompt Customization ──────────────────────────────────────

	/** Global custom instructions appended to all prompts. */
	static get promptGlobalInstructions(): string {
		return this.get('prompts.globalInstructions', '').trim();
	}

	/** Custom system prompt for chat (overrides default when non-empty). */
	static get promptChat(): string {
		return this.get('prompts.chat', '').trim();
	}

	/** Custom system prompt for /explain (overrides default when non-empty). */
	static get promptExplain(): string {
		return this.get('prompts.explain', '').trim();
	}

	/** Custom system prompt for /usage (overrides default when non-empty). */
	static get promptUsage(): string {
		return this.get('prompts.usage', '').trim();
	}

	/** Custom system prompt for /relationships (overrides default when non-empty). */
	static get promptRelationships(): string {
		return this.get('prompts.relationships', '').trim();
	}

	/** Custom system prompt for /research (overrides default when non-empty). */
	static get promptResearch(): string {
		return this.get('prompts.research', '').trim();
	}

	/** Custom system prompt for /refine (overrides default when non-empty). */
	static get promptRefine(): string {
		return this.get('prompts.refine', '').trim();
	}

	/** Custom system prompt for TODO agent (overrides default when non-empty). */
	static get promptTodo(): string {
		return this.get('prompts.todo', '').trim();
	}

	/** Custom prompt for observation distillation (overrides default when non-empty). */
	static get promptDistillObservations(): string {
		return this.get('prompts.distillObservations', '').trim();
	}

	/** Custom prompt for queue distillation (overrides default when non-empty). */
	static get promptDistillQueue(): string {
		return this.get('prompts.distillQueue', '').trim();
	}

	/** Custom prompt for card synthesis / AI draft (overrides default when non-empty). */
	static get promptSynthesizeCard(): string {
		return this.get('prompts.synthesizeCard', '').trim();
	}

	/**
	 * Get the effective prompt for a command.
	 * Returns custom prompt if set, otherwise the provided default.
	 * Always appends global instructions if set.
	 */
	static getEffectivePrompt(command: string, defaultPrompt: string): string {
		const customMap: Record<string, string> = {
			chat: this.promptChat,
			explain: this.promptExplain,
			usage: this.promptUsage,
			relationships: this.promptRelationships,
			research: this.promptResearch,
			refine: this.promptRefine,
			todo: this.promptTodo,
			distillObservations: this.promptDistillObservations,
			distillQueue: this.promptDistillQueue,
			synthesizeCard: this.promptSynthesizeCard,
		};

		const base = customMap[command] || defaultPrompt;
		const global = this.promptGlobalInstructions;
		return global ? `${base}\n\n## Additional Instructions\n${global}` : base;
	}

	// ─── Watchers ───────────────────────────────────────────────────

	/**
	 * Watch for configuration changes.
	 * @param callback Called when any ContextManager setting changes
	 * @returns Disposable to stop watching
	 */
	static onDidChange(callback: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(this.SECTION)) {
				callback(e);
			}
		});
	}

	/**
	 * Check if a specific configuration key changed.
	 */
	static didChange(e: vscode.ConfigurationChangeEvent, key: string): boolean {
		return e.affectsConfiguration(`${this.SECTION}.${key}`);
	}

	// ─── Validation ─────────────────────────────────────────────────

	/**
	 * Ensure cache expiration is never expired.
	 * Returns timestamp of when the cache entry should expire, or undefined if never.
	 */
	static getCacheExpirationTimestamp(): number | undefined {
		const days = this.cacheExpiration;
		if (days === 0) {
			return undefined; // Never expire
		}
		return Date.now() + (days * 24 * 60 * 60 * 1000);
	}

	/**
	 * Check if a timestamp has expired based on current settings.
	 */
	static isCacheExpired(timestamp: number): boolean {
		const expirationDays = this.cacheExpiration;
		if (expirationDays === 0) {
			return false; // Never expire
		}
		const expirationTime = expirationDays * 24 * 60 * 60 * 1000;
		return (Date.now() - timestamp) > expirationTime;
	}
}
