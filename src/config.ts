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

	/** Get a string config value, safely coercing non-string values. */
	private static getString(key: string, defaultValue: string = ''): string {
		const val = this.get(key, defaultValue);
		// Non-string primitives (boolean, number, null, undefined) → use default
		if (typeof val !== 'string') { return defaultValue; }
		return val.trim();
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

	static get maxKnowledgeCardsInContext(): number {
		return this.get('maxKnowledgeCardsInContext', 10);
	}

	// ─── Explanation Settings ───────────────────────────────────────

	static get explanationExpandContext(): boolean {
		return this.get('explanation.expandContext', true);
	}



	// ─── Search Settings ──────────────────────────────────────────

	/** Whether BM25 full-text search (SQLite FTS4) is enabled. */
	static get searchEnableFTS(): boolean {
		return this.get('search.enableFTS', true);
	}

	/** Max knowledge cards returned by #ctx card search results (1–20, default 5). */
	static get searchMaxCardResults(): number {
		return this.get('search.maxCardResults', 5);
	}

	/** Max results returned by #ctx cross-entity search (1–50, default 10). */
	static get searchMaxSearchResults(): number {
		return this.get('search.maxSearchResults', 10);
	}

	/** Snippet context tokens around match highlights (8–64, default 16). */
	static get searchSnippetTokens(): number {
		return this.get('search.snippetTokens', 16);
	}

	// Subagent settings removed — subagent tool is obsolete

	/**
	 * When true (default), the save/read/search cache and save knowledge card tools
	 * run silently with just a status line — no confirmation dialog interrupts the session.
	 * Set to false to show a confirmation prompt before each operation.
	 */
	static get toolsBackgroundMode(): boolean {
		return this.get('tools.backgroundMode', true);
	}

	// ─── Project Intelligence Settings ─────────────────────────────

	/** Enable tiered injection of conventions + tool hints into prompts. */
	static get intelligenceEnableTieredInjection(): boolean {
		return this.get('intelligence.enableTieredInjection', true);
	}

	/** Token budget for Tier 1 (always-injected) learnings. */
	static get intelligenceTier1MaxTokens(): number {
		return this.get('intelligence.tier1MaxTokens', 400);
	}

	/** Token budget for Tier 2 (task-relevant) learnings. */
	static get intelligenceTier2MaxTokens(): number {
		return this.get('intelligence.tier2MaxTokens', 400);
	}



	/** Inject conventions into prompts. */
	static get intelligenceInjectConventions(): boolean {
		return this.get('intelligence.injectConventions', true);
	}

	/** Inject working notes into prompts. */
	static get intelligenceInjectWorkingNotes(): boolean {
		return this.get('intelligence.injectWorkingNotes', true);
	}

	/** Inject tool hints into prompts. */
	static get intelligenceInjectToolHints(): boolean {
		return this.get('intelligence.injectToolHints', true);
	}

	/** Inject knowledge cards into prompts. */
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
		return this.getString('intelligence.autoLearn.modelFamily');
	}

	/** Preferred model family for AI workflow actions (empty = use default). */
	static get workflowModelFamily(): string {
		return this.getString('workflows.modelFamily');
	}

	/** Preferred model family for AI Draft / card synthesis (empty = use default). */
	static get synthesisModelFamily(): string {
		return this.getString('knowledgeCards.synthesisModelFamily');
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

	// ─── Session Tracking ───────────────────────────────────────────

	/** Track chat sessions in the Sessions tab. */
	static get sessionTrackingEnabled(): boolean {
		return this.get('sessionTracking.enabled', true);
	}

	// ─── Auto-Capture Settings ─────────────────────────────────────

	/** Enable auto-capture of observations from all chat interactions. */
	static get autoCaptureEnabled(): boolean {
		return this.get('autoCapture.enabled', true);
	}

	/** Run LLM extraction on all interactions to learn conventions. */
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
		return this.getString('prompts.globalInstructions');
	}

	/** Custom prompt for observation distillation (overrides default when non-empty). */
	static get promptDistillObservations(): string {
		return this.getString('prompts.distillObservations');
	}

	/** Custom prompt for queue distillation (overrides default when non-empty). */
	static get promptDistillQueue(): string {
		return this.getString('prompts.distillQueue');
	}

	/** Custom prompt for card synthesis / AI draft (overrides default when non-empty). */
	static get promptSynthesizeCard(): string {
		return this.getString('prompts.synthesizeCard');
	}

	/**
	 * Get the effective prompt for a command.
	 * Returns custom prompt if set, otherwise the provided default.
	 * Always appends global instructions if set.
	 */
	static getEffectivePrompt(command: string, defaultPrompt: string): string {
		const customMap: Record<string, string> = {
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



}
