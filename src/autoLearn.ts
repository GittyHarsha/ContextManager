/**
 * Auto-Learning Pipeline — extracts learnings from every chat interaction.
 *
 * After each tool-calling loop completes, this module analyzes the tool call
 * history and response text to automatically extract:
 *
 *  1. **Tool Hints** — when a search fails then a different search succeeds,
 *     record the working pattern and the anti-pattern. (regex-based, high precision)
 *  2. **Working Notes** — file relationships with LLM-synthesized insights
 *     explaining *why* files are connected, not just that they were read together.
 *  3. **Conventions** — project-wide rules extracted by a lightweight LLM call
 *     that distinguishes codebase conventions from task-specific advice.
 *
 * All auto-extracted items are saved with `confidence: 'inferred'` so they
 * appear in the "Pending Review" section of the dashboard. Nothing is
 * auto-confirmed — the engineer curates.
 *
 * **Caps & Decay:**
 *  - Hard caps per category prevent unbounded growth (default: 30 notes, 20 hints, 15 conventions)
 *  - When a cap is hit, the oldest *inferred* item is evicted before adding the new one
 *  - Only `inferred` items are ever evicted — `observed` and `confirmed` are safe
 *  - Items promoted to `confirmed` by the user are never counted toward the cap
 *
 * **Feedback Loop:**
 *  - User discards increment a per-category counter
 *  - When a category exceeds the discard threshold, auto-learn stops generating that type
 *  - Confirming an item resets the counter for that category
 *
 * **LLM-assisted extraction (default: enabled):**
 *  - One cheap LLM call (~200 input tokens) per interaction for conventions + notes
 *  - Falls back to regex extraction if no model is available
 *  - Tool hints always use regex (already high precision)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectManager } from './projects/ProjectManager';
import { ConfigurationManager } from './config';

// ─── Types ──────────────────────────────────────────────────────

interface SearchAttempt {
	toolName: string;
	query: string;
	callId: string;
	resultQuality: 'none' | 'weak' | 'strong';
	iteration: number;
}

interface FileAccess {
	filePath: string;
	callId: string;
	iteration: number;
}

/** Item that was auto-learned, for inline chat feedback. */
export interface AutoLearnedItem {
	type: 'convention' | 'toolHint' | 'workingNote';
	id: string;
	title: string;
	detail: string;
	category?: string;
}

export interface AutoLearnResult {
	toolHintsCreated: number;
	workingNotesCreated: number;
	conventionsCreated: number;
	evicted: number;
	/** Items created this run — used for inline chat feedback */
	items: AutoLearnedItem[];
}

interface ToolCallRoundLike {
	response: string;
	toolCalls: Array<{ name: string; input: any; callId: string }>;
}

/** Structured output from LLM extraction. */
interface LLMExtractionResult {
	conventions: Array<{
		category: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls';
		title: string;
		content: string;
	}>;
	relationships: Array<{
		subject: string;
		insight: string;
		relatedFiles: string[];
		relatedSymbols: string[];
	}>;
}

// ─── Constants ──────────────────────────────────────────────────

const SEARCH_TOOL_PATTERNS = [
	'grep', 'findtext', 'haystack', 'semantic_search', 'file_search',
];

const READ_TOOL_PATTERNS = [
	'read', 'listdir', 'list_dir',
];

const MIN_CO_READ_FILES = 2;

const LLM_EXTRACTION_TIMEOUT_MS = 8000;

/** Key used to track whether the one-time LLM cost warning has been shown. */
const LLM_COST_WARNING_SHOWN_KEY = 'contextManager.internal.autoLearn.llmCostWarningShown';

/**
 * Status bar item shown while auto-learn LLM extraction is running.
 * Created lazily on first use.
 */
let _autoLearnStatusBarItem: vscode.StatusBarItem | undefined;

function showAutoLearnStatusBar(): void {
	if (!_autoLearnStatusBarItem) {
		_autoLearnStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
	}
	_autoLearnStatusBarItem.text = '$(hubot~spin) Auto-learn active';
	_autoLearnStatusBarItem.tooltip = 'Auto-learn is making an LLM call to extract conventions and patterns';
	_autoLearnStatusBarItem.show();
}

function hideAutoLearnStatusBar(): void {
	_autoLearnStatusBarItem?.hide();
}

/**
 * Show a one-time informational message the first time auto-learn LLM mode
 * is actually triggered, so users are aware of the API cost.
 */
async function showOneTimeLLMCostWarning(): Promise<void> {
	const config = vscode.workspace.getConfiguration('contextManager');
	const alreadyShown = config.get<boolean>('internal.autoLearn.llmCostWarningShown', false);
	if (alreadyShown) { return; }

	vscode.window.showInformationMessage(
		'Auto-learn is making a lightweight LLM call to extract conventions and patterns from this chat interaction. ' +
		'This happens after each chat response. You can disable this in Settings → ContextManager → Auto-Learn → Use LLM.',
		'Got it', 'Disable LLM'
	).then(async choice => {
		if (choice === 'Disable LLM') {
			await config.update('intelligence.autoLearn.useLLM', false, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('Auto-learn LLM calls disabled. Regex-only extraction will be used.');
		}
	});

	// Mark as shown regardless of user choice (don't nag)
	await config.update('internal.autoLearn.llmCostWarningShown', true, vscode.ConfigurationTarget.Global);
}

const EMPTY_RESULT: AutoLearnResult = {
	toolHintsCreated: 0, workingNotesCreated: 0, conventionsCreated: 0, evicted: 0, items: [],
};

// ─── Main Entry Point ───────────────────────────────────────────

export async function runAutoLearn(
	toolCallRounds: ToolCallRoundLike[],
	toolCallResults: Record<string, { content: any[] }>,
	responseText: string,
	lastResponse: string,
	command: string,
	promptText: string,
	projectManager: ProjectManager,
): Promise<AutoLearnResult> {
	if (!ConfigurationManager.intelligenceAutoLearn) {
		return { ...EMPTY_RESULT };
	}

	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		return { ...EMPTY_RESULT };
	}

	// Commands that already have their own learning (/done calls retrospect)
	if (command === 'done' || command === 'context') {
		return { ...EMPTY_RESULT };
	}

	if (toolCallRounds.length === 0) {
		return { ...EMPTY_RESULT };
	}

	const projectId = activeProject.id;
	const result: AutoLearnResult = { toolHintsCreated: 0, workingNotesCreated: 0, conventionsCreated: 0, evicted: 0, items: [] };
	const discardThreshold = ConfigurationManager.autoLearnDiscardThreshold;

	try {
		// ── 0. Auto-expire old inferred items ──
		const expiryDays = ConfigurationManager.autoLearnExpiryDays;
		if (expiryDays > 0) {
			result.evicted += await expireOldInferred(projectId, projectManager, expiryDays);
		}

		// ── 1. Tool Hints (search fail→success patterns) — always regex ──
		const hintsPerRun = ConfigurationManager.autoLearnHintsPerRun;
		if (ConfigurationManager.autoLearnExtractToolHints && hintsPerRun > 0) {
			if (!projectManager.isSignalSuppressed(projectId, 'hint:search', discardThreshold)) {
				const searchAttempts = extractSearchAttempts(toolCallRounds, toolCallResults);
				const toolHints = detectToolHintPatterns(searchAttempts);
				for (const hint of toolHints.slice(0, hintsPerRun)) {
					// Deduplicate at extraction time
					const existing = projectManager.getToolHints(projectId);
					if (existing.some(h => h.pattern.toLowerCase() === hint.pattern.toLowerCase() && h.toolName === hint.toolName)) {
						continue;
					}
					result.evicted += await enforceCapToolHints(projectId, projectManager);
					const saved = await projectManager.addToolHint(
						projectId, hint.toolName, hint.pattern, hint.example, hint.antiPattern
					);
					if (saved) {
						result.toolHintsCreated++;
						result.items.push({
							type: 'toolHint', id: saved.id,
							title: `Search "${hint.pattern}"${hint.antiPattern ? ` not "${hint.antiPattern}"` : ''}`,
							detail: hint.example,
						});
					}
				}
			}
		}

		// ── 2 & 3. Conventions + Working Notes — LLM or regex ──
		const notesPerRun = ConfigurationManager.autoLearnNotesPerRun;
		const convsPerRun = ConfigurationManager.autoLearnConventionsPerRun;
		const extractNotes = ConfigurationManager.autoLearnExtractWorkingNotes && notesPerRun > 0;
		const extractConvs = ConfigurationManager.autoLearnExtractConventions && convsPerRun > 0;

		if (extractNotes || extractConvs) {
			// Determine which categories are suppressed
			const suppressedConvCategories = new Set<string>();
			for (const cat of ['architecture', 'naming', 'patterns', 'testing', 'tooling', 'pitfalls']) {
				if (projectManager.isSignalSuppressed(projectId, `convention:${cat}`, discardThreshold)) {
					suppressedConvCategories.add(cat);
				}
			}
			const notesSuppressed = projectManager.isSignalSuppressed(projectId, 'note:fileRelationship', discardThreshold);

			const shouldExtractNotes = extractNotes && !notesSuppressed;
			const shouldExtractConvs = extractConvs && suppressedConvCategories.size < 6; // If ALL suppressed, skip

			if (shouldExtractNotes || shouldExtractConvs) {
				// Try LLM extraction first, fall back to regex
				let llmResult: LLMExtractionResult | null = null;

				if (ConfigurationManager.autoLearnUseLLM) {
					await showOneTimeLLMCostWarning();
					showAutoLearnStatusBar();
					const fileAccesses = extractFileAccesses(toolCallRounds);
					const filePaths = [...new Set(fileAccesses.map(a => shortenPath(a.filePath)))].slice(0, 10);
					try {
						llmResult = await extractLearningsViaLLM(lastResponse, promptText, filePaths, command);
					} finally {
						hideAutoLearnStatusBar();
					}
				}

				// ── Working Notes ──
				if (shouldExtractNotes) {
					const relationships = llmResult?.relationships?.length
						? llmResult.relationships
						: extractFileRelationshipsFallback(toolCallRounds, responseText, promptText);

					for (const rel of relationships.slice(0, notesPerRun)) {
						// Deduplicate: check existing notes for >80% file overlap
						const existing = projectManager.getWorkingNotes(projectId);
						const isDupe = existing.some(n => {
							if (n.subject.toLowerCase() === rel.subject.toLowerCase()) { return true; }
							if (rel.relatedFiles.length > 0 && n.relatedFiles.length > 0) {
								const overlap = rel.relatedFiles.filter(f =>
									n.relatedFiles.some(ef => ef.includes(f) || f.includes(ef))
								);
								return overlap.length / Math.max(rel.relatedFiles.length, 1) > 0.8;
							}
							return false;
						});
						if (isDupe) { continue; }

						result.evicted += await enforceCapWorkingNotes(projectId, projectManager);
						const saved = await projectManager.addWorkingNote(
							projectId, rel.subject, rel.insight, rel.relatedFiles, rel.relatedSymbols,
							`auto-learned during /${command}`
						);
						if (saved) {
							result.workingNotesCreated++;
							result.items.push({
								type: 'workingNote', id: saved.id,
								title: rel.subject, detail: rel.insight.substring(0, 120),
							});
						}
					}
				}

				// ── Conventions ──
				if (shouldExtractConvs) {
					const conventions = llmResult?.conventions?.length
						? llmResult.conventions
						: detectConventionHintsFallback(responseText, command);

					for (const conv of conventions.slice(0, convsPerRun)) {
						// Skip suppressed categories
						if (suppressedConvCategories.has(conv.category)) { continue; }

						// Deduplicate at extraction time
						const existing = projectManager.getConventions(projectId);
						if (existing.some(c => c.title.toLowerCase() === conv.title.toLowerCase() && c.category === conv.category)) {
							continue;
						}

						result.evicted += await enforceCapConventions(projectId, projectManager);
						const saved = await projectManager.addConvention(
							projectId, conv.category, conv.title, conv.content, 'inferred',
							`auto-learned during /${command}`
						);
						if (saved) {
							result.conventionsCreated++;
							result.items.push({
								type: 'convention', id: saved.id,
								title: conv.title, detail: `[${conv.category}] ${conv.content.substring(0, 100)}`,
								category: conv.category,
							});
						}
					}
				}
			}
		}
	} catch (err) {
		console.warn('[ContextManager] Auto-learn extraction failed:', err);
	}

	const total = result.toolHintsCreated + result.workingNotesCreated + result.conventionsCreated;
	if (total > 0) {
		console.log(
			`[ContextManager] Auto-learned: ${result.toolHintsCreated} hints, ` +
			`${result.workingNotesCreated} notes, ${result.conventionsCreated} conventions` +
			(result.evicted > 0 ? ` (${result.evicted} old inferred items evicted)` : '')
		);
	}

	return result;
}

// ─── LLM-Assisted Extraction ────────────────────────────────────

const LLM_EXTRACTION_PROMPT = `You analyze AI assistant responses about codebases to extract project-wide learnings.

Extract ONLY items that are **project-wide conventions or architectural patterns** — NOT task-specific advice.

Rules:
- A "convention" is a rule/pattern that applies across the entire codebase (e.g., "All controllers inherit from BaseController")
- Do NOT extract generic programming advice (e.g., "always handle errors")
- A "relationship" explains WHY specific files are connected architecturally, not just that they were read together
- Be very selective — return empty arrays if nothing qualifies
- Category must be one of: architecture, naming, patterns, testing, tooling, pitfalls
- **Overlap detection:** If extracting a convention that semantically overlaps with what might already exist (similar titles, same architectural area), make the title and content HIGHLY SPECIFIC to enable deduplication. Use precise terminology and file/symbol names.

Respond with ONLY valid JSON (no markdown fences):
{"conventions":[{"category":"...","title":"short title","content":"full description"}],"relationships":[{"subject":"short label","insight":"why these are connected","relatedFiles":["path1","path2"],"relatedSymbols":["Symbol1"]}]}`;

async function extractLearningsViaLLM(
	lastResponse: string,
	promptText: string,
	filePaths: string[],
	command: string,
): Promise<LLMExtractionResult | null> {
	try {
		const modelFamily = ConfigurationManager.autoLearnModelFamily;
		const selector: vscode.LanguageModelChatSelector = modelFamily
			? { family: modelFamily }
			: {};
		const models = await vscode.lm.selectChatModels(selector);
		if (!models.length) { return null; }

		// Pick the first matching model (user's preferred family, or default)
		const model = models[0];

		// Build a compact user message with the response excerpt
		const responseExcerpt = lastResponse.length > 1500
			? lastResponse.substring(0, 1500) + '\n[...truncated]'
			: lastResponse;

		const userMessage = [
			`User asked (/${command}): ${promptText.substring(0, 200)}`,
			filePaths.length > 0 ? `Files explored: ${filePaths.join(', ')}` : '',
			`\nAI Response:\n${responseExcerpt}`,
		].filter(Boolean).join('\n');

		const messages = [
			vscode.LanguageModelChatMessage.User(LLM_EXTRACTION_PROMPT),
			vscode.LanguageModelChatMessage.User(userMessage),
		];

		// Send with a timeout
		const response = await Promise.race([
			model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token),
			new Promise<null>((_, reject) =>
				setTimeout(() => reject(new Error('LLM extraction timeout')), LLM_EXTRACTION_TIMEOUT_MS)
			),
		]);

		if (!response) { return null; }

		// Collect text from stream
		let text = '';
		for await (const part of (response as any).stream ?? (response as any).text ?? []) {
			if (typeof part === 'string') { text += part; }
			else if (part?.value) { text += part.value; }
		}

		// Parse JSON — strip markdown fences if present
		text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

		const parsed = JSON.parse(text) as LLMExtractionResult;

		// Validate structure
		if (!parsed || typeof parsed !== 'object') { return null; }

		const validCategories = new Set(['architecture', 'naming', 'patterns', 'testing', 'tooling', 'pitfalls']);
		const conventions = (parsed.conventions || []).filter(c =>
			c && typeof c.title === 'string' && typeof c.content === 'string' &&
			validCategories.has(c.category) && c.title.length > 5 && c.content.length > 10
		);
		const relationships = (parsed.relationships || []).filter(r =>
			r && typeof r.subject === 'string' && typeof r.insight === 'string' &&
			r.subject.length > 3 && r.insight.length > 15
		);

		return { conventions, relationships };
	} catch (err) {
		console.warn('[ContextManager] LLM extraction failed, falling back to regex:', err);
		return null;
	}
}

// ─── Cap Enforcement (evict oldest inferred) ────────────────────

async function enforceCapToolHints(
	projectId: string,
	pm: ProjectManager,
): Promise<number> {
	const cap = ConfigurationManager.autoLearnMaxToolHints;
	const all = pm.getToolHints(projectId);
	if (all.length < cap) { return 0; }

	// Evict oldest by updatedAt — tool hints don't have a confidence field,
	// so we evict the lowest-useCount (never manually used) first, then oldest.
	const sorted = [...all]
		.sort((a, b) => a.useCount - b.useCount || a.updatedAt - b.updatedAt);
	let evicted = 0;
	while (all.length - evicted >= cap) {
		const victim = sorted[evicted];
		if (!victim) { break; }
		await pm.removeToolHint(projectId, victim.id);
		evicted++;
	}
	return evicted;
}

async function enforceCapWorkingNotes(
	projectId: string,
	pm: ProjectManager,
): Promise<number> {
	const cap = ConfigurationManager.autoLearnMaxWorkingNotes;
	const all = pm.getWorkingNotes(projectId);
	const inferred = all.filter(n => n.confidence === 'inferred');
	if (inferred.length < cap) { return 0; }

	// Evict oldest inferred (confirmed/observed are never touched)
	const sorted = [...inferred].sort((a, b) => a.updatedAt - b.updatedAt);
	let evicted = 0;
	while (inferred.length - evicted >= cap) {
		const victim = sorted[evicted];
		if (!victim) { break; }
		await pm.removeWorkingNote(projectId, victim.id);
		evicted++;
	}
	return evicted;
}

async function enforceCapConventions(
	projectId: string,
	pm: ProjectManager,
): Promise<number> {
	const cap = ConfigurationManager.autoLearnMaxConventions;
	const all = pm.getConventions(projectId);
	const inferred = all.filter(c => c.confidence === 'inferred');
	if (inferred.length < cap) { return 0; }

	// Evict oldest inferred (observed/confirmed are never touched)
	const sorted = [...inferred].sort((a, b) => a.updatedAt - b.updatedAt);
	let evicted = 0;
	while (inferred.length - evicted >= cap) {
		const victim = sorted[evicted];
		if (!victim) { break; }
		await pm.removeConvention(projectId, victim.id);
		evicted++;
	}
	return evicted;
}

// ─── Time-Based Expiry ──────────────────────────────────────────

/**
 * Remove inferred items older than `expiryDays`.
 * Only touches items with confidence === 'inferred'.
 */
async function expireOldInferred(
	projectId: string,
	pm: ProjectManager,
	expiryDays: number,
): Promise<number> {
	const cutoff = Date.now() - (expiryDays * 24 * 60 * 60 * 1000);
	let evicted = 0;

	// Expire old inferred conventions
	for (const c of pm.getConventions(projectId)) {
		if (c.confidence === 'inferred' && c.updatedAt < cutoff) {
			await pm.removeConvention(projectId, c.id);
			evicted++;
		}
	}

	// Expire old inferred working notes
	for (const n of pm.getWorkingNotes(projectId)) {
		if (n.confidence === 'inferred' && n.updatedAt < cutoff) {
			await pm.removeWorkingNote(projectId, n.id);
			evicted++;
		}
	}

	// Expire old tool hints (no confidence field — use updatedAt + useCount === 0)
	for (const h of pm.getToolHints(projectId)) {
		if (h.useCount === 0 && h.updatedAt < cutoff) {
			await pm.removeToolHint(projectId, h.id);
			evicted++;
		}
	}

	if (evicted > 0) {
		console.log(`[ContextManager] Auto-learn: expired ${evicted} inferred items older than ${expiryDays} days`);
	}
	return evicted;
}

// ─── Search Pattern Extraction (regex — high precision) ─────────

function extractSearchAttempts(
	toolCallRounds: ToolCallRoundLike[],
	toolCallResults: Record<string, { content: any[] }>,
): SearchAttempt[] {
	const attempts: SearchAttempt[] = [];

	for (let i = 0; i < toolCallRounds.length; i++) {
		const round = toolCallRounds[i];
		for (const tc of round.toolCalls) {
			const nameLower = tc.name.toLowerCase();
			if (!SEARCH_TOOL_PATTERNS.some(p => nameLower.includes(p))) { continue; }

			const query = extractQueryFromInput(tc.input);
			if (!query) { continue; }

			const resultObj = toolCallResults[tc.callId];
			const resultQuality = resultObj ? assessSearchQuality(resultObj) : 'none';

			attempts.push({
				toolName: simplifyToolName(tc.name),
				query, callId: tc.callId, resultQuality, iteration: i,
			});
		}
	}

	return attempts;
}

function detectToolHintPatterns(
	attempts: SearchAttempt[],
): Array<{ toolName: string; pattern: string; antiPattern: string; example: string }> {
	const hints: Array<{ toolName: string; pattern: string; antiPattern: string; example: string }> = [];
	const usedIndices = new Set<number>();

	for (let i = 0; i < attempts.length; i++) {
		if (usedIndices.has(i)) { continue; }
		const failed = attempts[i];
		// Match on 'none' or 'weak' results as the "failed" attempt
		if (failed.resultQuality === 'strong') { continue; }

		for (let j = i + 1; j < attempts.length && j <= i + 5; j++) {
			if (usedIndices.has(j)) { continue; }
			const succeeded = attempts[j];
			if (succeeded.resultQuality !== 'strong') { continue; }
			if (succeeded.toolName !== failed.toolName) { continue; }
			if (normalizeQuery(failed.query) === normalizeQuery(succeeded.query)) { continue; }

			hints.push({
				toolName: failed.toolName,
				pattern: succeeded.query,
				antiPattern: failed.query,
				example: `Search "${succeeded.query}" instead of "${failed.query}"`,
			});
			usedIndices.add(i);
			usedIndices.add(j);
			break;
		}
	}

	return hints;
}

// ─── File Relationship Detection (regex fallback) ───────────────

function extractFileAccesses(toolCallRounds: ToolCallRoundLike[]): FileAccess[] {
	const accesses: FileAccess[] = [];

	for (let i = 0; i < toolCallRounds.length; i++) {
		for (const tc of toolCallRounds[i].toolCalls) {
			if (!READ_TOOL_PATTERNS.some(p => tc.name.toLowerCase().includes(p))) { continue; }
			const filePath = tc.input?.filePath || tc.input?.path || tc.input?.file;
			if (typeof filePath === 'string' && filePath.trim()) {
				accesses.push({ filePath: filePath.trim(), callId: tc.callId, iteration: i });
			}
		}
	}

	return accesses;
}

/**
 * Regex fallback for file relationship detection (used when LLM is unavailable).
 */
function extractFileRelationshipsFallback(
	toolCallRounds: ToolCallRoundLike[],
	responseText: string,
	promptText: string,
): Array<{ subject: string; insight: string; relatedFiles: string[]; relatedSymbols: string[] }> {
	const fileAccesses = extractFileAccesses(toolCallRounds);
	if (fileAccesses.length < MIN_CO_READ_FILES) { return []; }

	const groups: FileAccess[][] = [];
	let currentGroup: FileAccess[] = [fileAccesses[0]];

	for (let i = 1; i < fileAccesses.length; i++) {
		if (fileAccesses[i].iteration - fileAccesses[i - 1].iteration <= 2) {
			currentGroup.push(fileAccesses[i]);
		} else {
			if (currentGroup.length >= MIN_CO_READ_FILES) { groups.push(currentGroup); }
			currentGroup = [fileAccesses[i]];
		}
	}
	if (currentGroup.length >= MIN_CO_READ_FILES) { groups.push(currentGroup); }

	const results: Array<{ subject: string; insight: string; relatedFiles: string[]; relatedSymbols: string[] }> = [];

	for (const group of groups) {
		const filePaths = [...new Set(group.map(a => a.filePath))];
		if (filePaths.length < MIN_CO_READ_FILES) { continue; }

		const dirs = new Set(filePaths.map(f => path.dirname(f)));
		if (dirs.size === 1 && filePaths.length <= 3) { continue; }

		const fileNames = filePaths.map(f => path.basename(f)).slice(0, 4);
		const subject = `Relationship: ${fileNames.join(' ↔ ')}`;

		const promptSummary = promptText.length > 120
			? promptText.substring(0, 117) + '...'
			: promptText;

		const insight = `These files were explored together when investigating: "${promptSummary}". ` +
			`Files: ${filePaths.slice(0, 6).map(f => shortenPath(f)).join(', ')}` +
			(filePaths.length > 6 ? ` (+${filePaths.length - 6} more)` : '');

		results.push({
			subject, insight,
			relatedFiles: filePaths.slice(0, 10),
			relatedSymbols: extractSymbolsFromText(responseText).slice(0, 5),
		});
	}

	return results;
}

// ─── Convention Detection (regex fallback) ──────────────────────

const CONVENTION_SIGNALS: Array<{
	regex: RegExp;
	category: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls';
}> = [
	{ regex: /\b(?:always|must|should|never)\s+(?:use|follow|implement|avoid|call|return|throw|check)\b/i, category: 'patterns' },
	{ regex: /\b(?:naming convention|name(?:d|s)?\s+(?:with|using|by)\s+(?:a |the )?\w+(?:Case|case|prefix|suffix))\b/i, category: 'naming' },
	{ regex: /\b(?:architecture|architectural|design pattern|layer(?:ed|ing)?|module boundary)\b/i, category: 'architecture' },
	{ regex: /\b(?:test(?:ing)? (?:convention|pattern|strategy)|(?:unit|integration|e2e) test)\b/i, category: 'testing' },
	{ regex: /\b(?:pitfall|footgun|gotcha|common mistake|anti-?pattern|deprecated)\b/i, category: 'pitfalls' },
];

/**
 * Regex fallback for convention detection (used when LLM is unavailable).
 */
function detectConventionHintsFallback(
	responseText: string,
	command: string,
): Array<{ category: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls'; title: string; content: string }> {
	const analyticalCommands = ['explain', 'usage', 'relationships', 'chat', 'knowledge'];
	if (!analyticalCommands.includes(command)) { return []; }
	if (responseText.length < 200) { return []; }

	const results: Array<{ category: typeof CONVENTION_SIGNALS[0]['category']; title: string; content: string }> = [];
	const sentences = responseText.split(/(?<=[.!?])\s+/).filter(s => s.length > 30 && s.length < 500);

	for (const sentence of sentences) {
		for (const signal of CONVENTION_SIGNALS) {
			if (!signal.regex.test(sentence)) { continue; }
			if (/^(if|when|could|would|might|maybe|perhaps)\b/i.test(sentence.trim())) { continue; }

			const title = sentence.length > 80
				? sentence.substring(0, 77).replace(/\s+\S*$/, '') + '...'
				: sentence;

			results.push({
				category: signal.category,
				title: title.replace(/^\*+|\*+$/g, '').trim(),
				content: sentence.trim(),
			});
			break;
		}
	}

	return results;
}

// ─── Utility Functions ──────────────────────────────────────────

function extractQueryFromInput(input: any): string | undefined {
	if (!input) { return undefined; }
	return input.query || input.pattern || input.text || input.search || undefined;
}

/**
 * Assess search result quality: 'none', 'weak', or 'strong'.
 * 'weak' means some results but very few — still worth noting
 * if a later search yields a 'strong' result.
 */
function assessSearchQuality(result: { content: any[] }): 'none' | 'weak' | 'strong' {
	if (!result?.content?.length) { return 'none'; }

	let totalTextLength = 0;
	for (const part of result.content) {
		const text: string | undefined = part?.value || part?.text;
		if (!text) { continue; }
		const lower = text.toLowerCase();
		if (
			lower.includes('no results') || lower.includes('no matches') ||
			lower.includes('not found') || lower.includes('0 results') ||
			lower.includes('no knowledge cards found') || lower.includes('no cached entries found') ||
			lower.includes('no todos found') || lower.includes('no matching')
		) { return 'none'; }
		totalTextLength += text.length;
	}

	if (totalTextLength === 0) { return 'none'; }
	// Fewer than 3 short lines → weak
	if (totalTextLength < 200) { return 'weak'; }
	return 'strong';
}

function simplifyToolName(name: string): string {
	return name.replace(/^contextManager_/i, '').replace(/^haystack/i, 'search:').replace(/_/g, ':');
}

function normalizeQuery(query: string): string {
	return query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function shortenPath(filePath: string): string {
	const parts = filePath.split(/[\\/]/);
	return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : filePath;
}

function extractSymbolsFromText(text: string): string[] {
	const symbolRegex = /\b([A-Z][a-zA-Z0-9]{2,}(?:[A-Z][a-z]+)+)\b/g;
	const symbols = new Set<string>();
	let match;
	while ((match = symbolRegex.exec(text)) !== null) {
		symbols.add(match[1]);
		if (symbols.size >= 10) { break; }
	}
	return [...symbols];
}
