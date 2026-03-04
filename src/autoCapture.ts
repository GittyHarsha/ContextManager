/**
 * Auto-Capture Service — zero-friction observation logging from ALL chat participants.
 *
 * v1.7.0 enhancements inspired by claude-mem's PostToolUse capture engine:
 *
 *  1. **Typed observations** — each observation is classified as bugfix, feature,
 *     discovery, decision, refactor, or change (via heuristic classification)
 *  2. **Content-hash dedup** — hash of (prompt + response summary) with 30s
 *     dedup window. Replaces naive throttle timer.
 *  3. **Privacy tags** — `<private>content</private>` stripped before storage
 *  4. **Token economics** — tracks estimated discovery cost vs read cost
 *  5. **Tool call capture** — interactions pipe tool call metadata into
 *     observations for per-tool-call granularity
 *  6. **FTS4 indexing** — observations indexed in SearchIndex for timeline navigation
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectManager } from './projects/ProjectManager';
import { ConfigurationManager } from './config';
import * as bgTasks from './backgroundTasks';
import type { AnchorStub } from './projects/types';

// ─── Types ──────────────────────────────────────────────────────

/** Observation classification types (inspired by claude-mem code.json mode). */
export type ObservationType =
	| 'bugfix'      // Something was broken, now fixed
	| 'feature'     // New capability or functionality
	| 'discovery'   // Learning about existing system
	| 'decision'    // Architectural/design choice
	| 'refactor'    // Code restructured, behavior unchanged
	| 'change';     // Generic modification (docs, config, misc)

/** Emojis for each observation type. */
export const OBSERVATION_TYPE_EMOJI: Record<ObservationType, string> = {
	bugfix: '🔴',
	feature: '🟣',
	discovery: '🔵',
	decision: '⚖️',
	refactor: '🔄',
	change: '✅',
};

export interface Observation {
	id: string;
	timestamp: number;
	prompt: string;
	responseSummary: string;
	participant: string;
	/** Observation classification. */
	type: ObservationType;
	/** Content hash for deduplication. */
	contentHash: string;
	/** Files mentioned in the interaction. */
	filesReferenced: string[];
	/** Tool calls captured from chat interactions. */
	toolCalls?: Array<{ name: string; input?: string }>;
	/** Estimated token cost of the original interaction. */
	discoveryTokens: number;
	/** Estimated token cost to read this observation. */
	readTokens: number;
	learningsExtracted?: boolean;
	/** Project ID this observation belongs to (for scoping). */
	projectId?: string;
}

// ─── Constants ──────────────────────────────────────────────────

const STORAGE_KEY = 'contextManager.autoCapture.observations'; // legacy globalState key (migration only)
const OBSERVATIONS_FILE = 'observations.json';
const DEDUP_WINDOW_MS = 30_000;
const MAX_OBSERVATIONS = 50;
const LLM_TIMEOUT_MS = 8_000;
const MIN_RESPONSE_LENGTH = 100;
const CHARS_PER_TOKEN = 4;

/** Regex to strip `<private>...</private>` tags and their content. */
const PRIVACY_TAG_REGEX = /<private>[\s\S]*?<\/private>/gi;

// ─── LLM Extraction Prompt ─────────────────────────────────────

const CAPTURE_EXTRACTION_PROMPT = `You analyze conversations between a developer and an AI assistant about a codebase.
Extract ONLY project-wide learnings — conventions, architectural patterns, or file relationships.

Rules:
- A "convention" is a rule/pattern that applies across the entire codebase
- Do NOT extract generic programming advice ("always handle errors")
- A "relationship" explains WHY specific files/modules are connected architecturally
- Be very selective — return empty arrays if nothing qualifies
- Category must be one of: architecture, naming, patterns, testing, tooling, pitfalls

Respond with ONLY valid JSON (no markdown fences):
{"conventions":[{"category":"...","title":"short title","content":"full description"}],"relationships":[{"subject":"short label","insight":"why these are connected","relatedFiles":["path1"],"relatedSymbols":["Symbol1"]}]}`;

/**
 * Extended prompt was previously used for single-turn card extraction.
 * Now single-turn uses the same CAPTURE_EXTRACTION_PROMPT as multi-turn.
 */

/**
 * Anchor extraction prompt — identifies load-bearing tool results for a knowledge card.
 */
const ANCHOR_EXTRACTION_PROMPT = `Given the knowledge card above and the tool calls below, identify ONLY the tool results
that this explanation directly cites or relies on — not exploratory reads, failed searches,
or results the assistant tried but did not use.

For each load-bearing result, return:
  { "filePath": "...", "symbolName": "optional", "startLine": number_or_null, "endLine": number_or_null, "stubContent": "verbatim lines from the result" }

Return an empty array if no tool results are genuinely load-bearing for this explanation.
Be conservative — false positives (noise anchors) are worse than false negatives (no anchors).

Respond with ONLY valid JSON (no markdown fences):
{"anchors":[]}`;


// ─── Content Hashing ────────────────────────────────────────────

function computeContentHash(prompt: string, responseSummary: string): string {
	let hash1 = 5381;
	let hash2 = 52711;
	const str = prompt + '|' + responseSummary;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		hash1 = ((hash1 << 5) + hash1 + c) | 0;
		hash2 = ((hash2 << 5) + hash2 + c) | 0;
	}
	return (hash1 >>> 0).toString(16).padStart(8, '0') + (hash2 >>> 0).toString(16).padStart(8, '0');
}

// ─── Privacy Tag Stripping ──────────────────────────────────────

function stripPrivacyTags(text: string): string {
	return text.replace(PRIVACY_TAG_REGEX, '[REDACTED]');
}

// ─── Observation Type Classification ────────────────────────────

function classifyObservation(prompt: string, response: string): ObservationType {
	const combined = (prompt + ' ' + response).toLowerCase();

	// Score each category by counting keyword hits — highest score wins.
	// This avoids greedy first-match where broad patterns steal everything.
	const scores: Record<ObservationType, number> = {
		bugfix: 0, feature: 0, refactor: 0, decision: 0, discovery: 0, change: 0,
	};

	const patterns: [ObservationType, RegExp][] = [
		['bugfix',    /\b(fix(ed|es|ing)?|bug(s|gy)?|error|crash(ed|es)?|broken|regression|patch|hotfix|defect|fault)\b/g],
		['feature',   /\b(add(ed|s|ing)?|implement(ed|s|ing)?|new feature|introduce[ds]?|support(s|ed|ing)? for|wire[ds]? up|enabl(e[ds]?|ing))\b/g],
		['refactor',  /\b(refactor(ed|s|ing)?|restructur(e[ds]?|ing)|reorganiz(e[ds]?|ing)|clean(ed|ing)? up|renam(e[ds]?|ing)|extract(ed|s|ing)?|split(ting)? into|mov(e[ds]?|ing) to)\b/g],
		['decision',  /\b(should we|trade-?off|decision|chose|approach|alternative|pros and cons|why did|rationale|design choice|weigh(ed|ing)?)\b/g],
		['discovery', /\b(how does|what is|explain(ed|s|ing)?|understand(ing)?|investigat(e[ds]?|ing)|look(ed|ing)? into|find out|where is|search(ed|ing)? for|discover(ed|y)?|learn(ed|ing)?)\b/g],
	];

	for (const [type, regex] of patterns) {
		const matches = combined.match(regex);
		if (matches) { scores[type] = matches.length; }
	}

	// Pick the type with the highest score; ties broken by pattern order above
	let best: ObservationType = 'change';
	let bestScore = 0;
	for (const [type] of patterns) {
		if (scores[type] > bestScore) {
			bestScore = scores[type];
			best = type;
		}
	}
	return best;
}

function extractFilePaths(text: string): string[] {
	const fileRegex = /(?:^|\s|["'`(])([a-zA-Z0-9_\-./\\]+\.[a-zA-Z]{1,10})(?:\s|["'`)]|$|[,:;])/gm;
	const files = new Set<string>();
	let match;
	while ((match = fileRegex.exec(text)) !== null) {
		const p = match[1];
		if (p.length > 3 && p.length < 200 &&
			!p.startsWith('http') && !p.startsWith('www.') &&
			!/^\d+\.\d+\.\d+/.test(p)) {
			files.add(p);
		}
		if (files.size >= 20) { break; }
	}
	return [...files];
}

// ─── Service ────────────────────────────────────────────────────

export class AutoCaptureService {
	private _observations: Observation[] = [];
	private _searchIndex?: import('./search/SearchIndex').SearchIndex;
	private _workflowEngine?: import('./workflows/WorkflowEngine').WorkflowEngine;

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _projectManager: ProjectManager,
	) {
		// Load from disk; migrate from globalState on first run
		try {
			const storagePath = _context.globalStorageUri.fsPath;
			const diskFile = path.join(storagePath, OBSERVATIONS_FILE);
			if (fs.existsSync(diskFile)) {
				this._observations = JSON.parse(fs.readFileSync(diskFile, 'utf8'));
			} else {
				// One-time migration
				const legacy = _context.globalState.get<Observation[]>(STORAGE_KEY, []);
				this._observations = legacy;
				if (!fs.existsSync(storagePath)) { fs.mkdirSync(storagePath, { recursive: true }); }
				fs.writeFileSync(diskFile, JSON.stringify(legacy), 'utf8');
				_context.globalState.update(STORAGE_KEY, undefined);
			}
		} catch {
			this._observations = [];
		}
	}

	/** Attach the centralized WorkflowEngine for observation-created triggers. */
	setWorkflowEngine(engine: import('./workflows/WorkflowEngine').WorkflowEngine): void {
		this._workflowEngine = engine;
	}

	/** Flush in-memory observations to disk (synchronous). */
	private _persistToDisk(): void {
		try {
			const storagePath = this._context.globalStorageUri.fsPath;
			if (!fs.existsSync(storagePath)) { fs.mkdirSync(storagePath, { recursive: true }); }
			fs.writeFileSync(path.join(storagePath, OBSERVATIONS_FILE), JSON.stringify(this._observations), 'utf8');
		} catch (err) {
			console.error('[AutoCapture] Failed to persist observations:', err);
		}
	}

	/** Wire up the FTS4 search index for observation indexing. */
	setSearchIndex(index: import('./search/SearchIndex').SearchIndex): void {
		this._searchIndex = index;
	}

	// ─── Public API ─────────────────────────────────────────────

	/**
	 * Called from the ModelResponse chatHook. Records a typed, deduped,
	 * privacy-stripped observation with token economics.
	 */
	async onModelResponse(
		promptText: string,
		responseText: string,
		participant?: string,
	): Promise<void> {
		if (!ConfigurationManager.autoCaptureEnabled) { return; }
		if (participant === 'contextManager') { return; }
		if (!promptText?.trim() || !responseText?.trim()) { return; }
		if (responseText.length < MIN_RESPONSE_LENGTH) { return; }

		const project = this._projectManager.getActiveProject();
		if (!project) { return; }

		// ── Privacy: strip <private> tags ──
		const cleanPrompt = stripPrivacyTags(promptText);
		const cleanResponse = stripPrivacyTags(responseText);

		const promptSummary = cleanPrompt.substring(0, 500);
		const respSummary = summarizeResponse(cleanResponse);

		// ── Content-hash dedup (30s window) ──
		const contentHash = computeContentHash(promptSummary, respSummary);
		const now = Date.now();
		const isDuplicate = this._observations.some(
			o => o.contentHash === contentHash && (now - o.timestamp) < DEDUP_WINDOW_MS
		);
		if (isDuplicate) { return; }

		// ── Token economics ──
		const discoveryTokens = Math.ceil((promptText.length + responseText.length) / CHARS_PER_TOKEN);
		const readTokens = Math.ceil((promptSummary.length + respSummary.length) / CHARS_PER_TOKEN);

		const obsType = classifyObservation(cleanPrompt, cleanResponse);
		const filesReferenced = extractFilePaths(cleanPrompt + ' ' + cleanResponse);

		const observation: Observation = {
			id: `obs_${now}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: now,
			prompt: promptSummary,
			responseSummary: respSummary,
			participant: participant || 'copilot',
			type: obsType,
			contentHash,
			filesReferenced,
			discoveryTokens,
			readTokens,
			projectId: project.id,
		};

		this._observations.push(observation);
		if (this._observations.length > ConfigurationManager.autoCaptureMaxObservations) {
			this._observations = this._observations.slice(-ConfigurationManager.autoCaptureMaxObservations);
		}

		this._persistToDisk();
		this._indexObservation(observation, project.id);

		// Fire observation-created workflow trigger
		if (observation.projectId) {
			this._workflowEngine?.fireObservationCreated(observation.projectId, observation).catch(err =>
				console.warn('[AutoCapture/Workflow] observation-created trigger error:', err)
			);
		}

		console.log(`[ContextManager] Auto-captured ${OBSERVATION_TYPE_EMOJI[obsType]} ${obsType} from ${observation.participant} (saved ${discoveryTokens - readTokens} tokens)`);

		if (ConfigurationManager.autoCaptureLearnFromAll && ConfigurationManager.autoLearnUseLLM) {
			this._extractLearningsBackground(cleanPrompt, cleanResponse, project.id).catch(() => {});
		}
	}

	/**
	 * Capture tool call metadata from chat interactions.
	 * Creates per-tool-call observations with granular metadata.
	 */
	async captureToolCalls(
		command: string,
		promptText: string,
		toolCallRounds: Array<{ response: string; toolCalls: Array<{ name: string; input: any; callId: string }> }>,
		_toolCallResults: Record<string, any>,
	): Promise<void> {
		if (!ConfigurationManager.autoCaptureEnabled) { return; }

		const project = this._projectManager.getActiveProject();
		if (!project) { return; }

		const now = Date.now();
		const cleanPrompt = stripPrivacyTags(promptText).substring(0, 300);

		const allToolCalls: Array<{ name: string; input?: string }> = [];
		const allFiles: string[] = [];

		for (const round of toolCallRounds) {
			for (const tc of round.toolCalls) {
				allToolCalls.push({
					name: tc.name,
					input: typeof tc.input === 'string' ? tc.input.substring(0, 200) : JSON.stringify(tc.input).substring(0, 200),
				});
				const filePath = tc.input?.filePath || tc.input?.path || tc.input?.file;
				if (filePath) { allFiles.push(filePath); }
			}
		}

		if (allToolCalls.length === 0) { return; }

		const condensedResponse = toolCallRounds.map(r => r.response || '').join(' ').substring(0, 500);
		const respSummary = summarizeResponse(condensedResponse);
		const contentHash = computeContentHash(cleanPrompt, respSummary);

		const isDuplicate = this._observations.some(
			o => o.contentHash === contentHash && (now - o.timestamp) < DEDUP_WINDOW_MS
		);
		if (isDuplicate) { return; }

		const discoveryTokens = toolCallRounds.reduce((sum, r) =>
			sum + Math.ceil(((r.response || '').length + r.toolCalls.reduce((s, tc) =>
				s + (typeof tc.input === 'string' ? tc.input.length : JSON.stringify(tc.input).length), 0)) / CHARS_PER_TOKEN), 0);
		const readTokens = Math.ceil((cleanPrompt.length + respSummary.length + allToolCalls.length * 30) / CHARS_PER_TOKEN);

		const obsType = classifyObservation(cleanPrompt, condensedResponse);

		const observation: Observation = {
			id: `obs_${now}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: now,
			prompt: `[/${command}] ${cleanPrompt}`,
			responseSummary: respSummary,
			participant: 'contextManager',
			type: obsType,
			contentHash,
			filesReferenced: [...new Set(allFiles)].slice(0, 20),
			toolCalls: allToolCalls.slice(0, 20),
			discoveryTokens,
			readTokens,
			projectId: project.id,
		};

		this._observations.push(observation);
		if (this._observations.length > ConfigurationManager.autoCaptureMaxObservations) {
			this._observations = this._observations.slice(-ConfigurationManager.autoCaptureMaxObservations);
		}

		this._persistToDisk();
		this._indexObservation(observation, project.id);

		// Fire observation-created workflow trigger
		if (observation.projectId) {
			this._workflowEngine?.fireObservationCreated(observation.projectId, observation).catch(err =>
				console.warn('[AutoCapture/Workflow] observation-created trigger error:', err)
			);
		}

		console.log(`[ContextManager] Captured ${allToolCalls.length} tool calls from /${command} (${OBSERVATION_TYPE_EMOJI[obsType]} ${obsType}, saved ${discoveryTokens - readTokens} tokens)`);
	}

	getRecentObservations(maxAgeMs: number = 24 * 60 * 60 * 1000, projectId?: string): Observation[] {
		const cutoff = Date.now() - maxAgeMs;
		let filtered = this._observations.filter(o => o.timestamp > cutoff);
		if (projectId) {
			filtered = filtered.filter(o => o.projectId === projectId);
		}
		return filtered;
	}

	getObservationById(id: string): Observation | undefined {
		return this._observations.find(o => o.id === id);
	}

	getSessionSummary(maxItems: number = 10, maxAgeMs?: number, projectId?: string): string {
		const recent = this.getRecentObservations(maxAgeMs, projectId);
		if (recent.length === 0) { return ''; }

		const items = recent.slice(-maxItems);
		const lines = items.map(o => {
			const relTime = formatRelativeTime(o.timestamp);
			const emoji = OBSERVATION_TYPE_EMOJI[o.type] || '📝';
			const promptPreview = o.prompt.substring(0, 120).replace(/\n+/g, ' ');
			return `- ${emoji} [${relTime}] ${promptPreview}${o.prompt.length > 120 ? '…' : ''}`;
		});

		return `**Recent Chat Activity (${items.length} interactions):**\n${lines.join('\n')}`;
	}

	getDetailedSummary(maxItems: number = 5, maxAgeMs?: number, projectId?: string): string {
		const recent = this.getRecentObservations(maxAgeMs, projectId);
		if (recent.length === 0) { return ''; }

		const items = recent.slice(-maxItems);
		const entries = items.map(o => {
			const relTime = formatRelativeTime(o.timestamp);
			const emoji = OBSERVATION_TYPE_EMOJI[o.type] || '📝';
			const responsePreview = o.responseSummary.substring(0, 200).replace(/\n+/g, ' ');
			return `${emoji} [${relTime}] Q: ${o.prompt.substring(0, 100)}${o.prompt.length > 100 ? '…' : ''}\nA: ${responsePreview}${o.responseSummary.length > 200 ? '…' : ''}`;
		});

		return `**Previous Session Context:**\n${entries.join('\n\n')}`;
	}

	get observationCount(): number {
		return this._observations.length;
	}

	/** Delete a single observation by id. Returns true if found and removed. */
	async deleteObservation(id: string): Promise<boolean> {
		const before = this._observations.length;
		this._observations = this._observations.filter(o => o.id !== id);
		if (this._observations.length === before) { return false; }
		this._persistToDisk();
		return true;
	}

	/** Delete all observations matching predicate. */
	async clearObservationsWhere(predicate: (o: Observation) => boolean): Promise<number> {
		const before = this._observations.length;
		this._observations = this._observations.filter(o => !predicate(o));
		const removed = before - this._observations.length;
		if (removed > 0) {
			this._persistToDisk();
		}
		return removed;
	}

	clearObservations(): void {
		this._observations = [];
		this._persistToDisk();
	}

	/**
	 * Use LLM to distill recent observations into structured intelligence:
	 * conventions, tool hints, and working notes.
	 * Returns suggestions for user review — does NOT auto-save.
	 * Only processes observations that haven't been distilled yet (learningsExtracted !== true).
	 */
	async distillObservations(maxObs: number = 40, projectId?: string): Promise<{
		conventions: Array<{ title: string; category: string; content: string }>;
		toolHints: Array<{ toolName: string; pattern: string; example?: string }>;
		workingNotes: Array<{ subject: string; insight: string; relatedFiles: string[] }>;
	} | null> {
		// Filter: only unprocessed observations
		let recent = this._observations
			.filter(o => o.learningsExtracted !== true)
			.slice(-maxObs);
		if (projectId) {
			recent = recent.filter(o => o.projectId === projectId);
		}
		if (recent.length === 0) { throw new Error('No unprocessed observations to distill. Chat with Copilot first to build up observations.'); }

		try {
			const modelFamily = ConfigurationManager.autoLearnModelFamily;
			const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
			const models = await vscode.lm.selectChatModels(selector);
			if (!models.length) { throw new Error(`No language model available${modelFamily ? ` (requested family: "${modelFamily}")` : ''}. Ensure Copilot Chat is active.`); }

			const obsText = recent.map((o, i) => {
				const lines = [`[${i + 1}] from:${o.participant} type:${o.type}`];
				if (o.prompt) { lines.push(`  Q: ${o.prompt.substring(0, 200)}`); }
				if (o.responseSummary) { lines.push(`  A: ${o.responseSummary.substring(0, 200)}`); }
				if (o.filesReferenced?.length) { lines.push(`  files: ${o.filesReferenced.slice(0, 5).join(', ')}`); }
				return lines.join('\n');
			}).join('\n\n');

			const defaultDistillObsPrompt = `You are analyzing observations from an AI coding agent's session history to extract reusable project intelligence.

Extract the following from the observations below. Be specific and actionable.

Return ONLY valid JSON with this exact shape:
{
  "conventions": [
    { "title": "short title (5-10 words)", "category": "architecture|naming|patterns|testing|tooling|pitfalls", "content": "clear description of this coding convention or pattern" }
  ],
  "toolHints": [
    { "toolName": "which tool/search strategy", "pattern": "what works", "example": "concrete example path or query" }
  ],
  "workingNotes": [
    { "subject": "what area/component", "insight": "what was learned about it", "relatedFiles": ["file1", "file2"] }
  ]
}

Guidelines:
- conventions: coding patterns, file organization rules, naming conventions found in the codebase
- toolHints: which folders/files to look in for certain queries, which search terms work, file patterns
- workingNotes: what specific components/areas the agent explored and what was discovered
- Skip generic advice. Only include things specific to THIS codebase.
- Max 5 each. If nothing meaningful found, return empty array.`;

			const instructions = ConfigurationManager.getEffectivePrompt('distillObservations', defaultDistillObsPrompt);
			const prompt = `${instructions}\n\nOBSERVATIONS (${recent.length} total):\n${obsText}`;

			const messages = [vscode.LanguageModelChatMessage.User(prompt)];
			const response = await Promise.race([
				models[0].sendRequest(messages, {}, new vscode.CancellationTokenSource().token),
				new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000)),
			]);
			if (!response) { throw new Error('Language model returned no response. Try again.'); }

			let text = '';
			for await (const part of (response as any).stream ?? (response as any).text ?? []) {
				if (typeof part === 'string') { text += part; }
				else if (part?.value) { text += part.value; }
			}
			text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
			const parsed = JSON.parse(text);
			
			// Mark processed observations as extracted to prevent re-processing
			for (const obs of recent) {
				obs.learningsExtracted = true;
			}
			this._persistToDisk();
			
			return {
				conventions: Array.isArray(parsed.conventions) ? parsed.conventions.slice(0, 5) : [],
				toolHints: Array.isArray(parsed.toolHints) ? parsed.toolHints.slice(0, 5) : [],
				workingNotes: Array.isArray(parsed.workingNotes) ? parsed.workingNotes.slice(0, 5) : [],
			};
		} catch (err) {
			console.error('[ContextManager] distillObservations failed:', err);
			return null;
		}
	}

	/**
	 * Distill a curated set of queued card candidates into synthesized knowledge card proposals.
	 * Processes candidates iteratively in small batches to avoid content truncation.
	 * Each batch gets the LLM's full attention with complete content.
	 */
	async distillQueue(
		candidates: Array<{ id: string; prompt: string; response: string; participant: string }>
	): Promise<Array<{
		title: string;
		category: string;
		content: string;
		reasoning: string;
		confidence: number;
		sourceIndices: number[];
	}> | null> {
		if (!candidates.length) { return null; }
		try {
			const modelFamily = ConfigurationManager.autoLearnModelFamily;
			const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
			const models = await vscode.lm.selectChatModels(selector);
			if (!models.length) { return null; }

			const batchSize = ConfigurationManager.cardQueueDistillBatchSize;
			const maxCards = ConfigurationManager.cardQueueMaxCardsPerDistill;
			const allCards: Array<{
				title: string; category: string; content: string;
				reasoning: string; confidence: number; sourceIndices: number[];
			}> = [];

			// Process candidates in batches — no content truncation
			for (let i = 0; i < candidates.length && allCards.length < maxCards; i += batchSize) {
				const batch = candidates.slice(i, i + batchSize);
				const candidateText = batch.map((c, j) => [
					`[${i + j + 1}] from:${c.participant}`,
					`  Q: ${c.prompt}`,
					`  A: ${c.response}`,
				].join('\n')).join('\n\n');

				const remaining = maxCards - allCards.length;
				const defaultDistillQueuePrompt = `You are extracting knowledge cards from AI chat responses for a software project reference.

Your task: turn each response into one or more self-contained knowledge cards that PRESERVE the full technical details.
Do NOT summarize or compress — a card should be as detailed as the source material.
A developer reading the card alone (without the original response) should learn everything from it.

Return ONLY valid JSON with this exact shape:
{
  "cards": [
    {
      "title": "descriptive title (5-10 words)",
      "category": "architecture|pattern|convention|explanation|note",
      "content": "full technical content — preserve code snippets, exact values, step-by-step instructions, caveats, and examples verbatim. Do NOT truncate or summarize.",
      "reasoning": "which response(s) this came from and why it is worth keeping",
      "confidence": 0.85,
      "sourceIndices": [1]
    }
  ]
}

Guidelines:
- One card per distinct topic or insight — do not merge unrelated content
- content must be comprehensive: include all code, commands, file paths, config values, and edge cases from the source
- Preserve markdown formatting, code blocks, and lists from the original
- confidence: 0.0–1.0 reflecting how reusable and project-specific this knowledge is
- Do not skip responses — every response should produce at least one card`;

				const instructions = ConfigurationManager.getEffectivePrompt('distillQueue', defaultDistillQueuePrompt);
				const prompt = `${instructions}\n\nMax ${remaining} cards for this batch.\n\nRESPONSES (${batch.length} of ${candidates.length} total, batch starting at #${i + 1}):\n${candidateText}`;

				const messages = [vscode.LanguageModelChatMessage.User(prompt)];
				const response = await Promise.race([
					models[0].sendRequest(messages, {}, new vscode.CancellationTokenSource().token),
					new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 60_000)),
				]);
				if (!response) { continue; }

				let text = '';
				for await (const part of (response as any).stream ?? (response as any).text ?? []) {
					if (typeof part === 'string') { text += part; }
					else if (part?.value) { text += part.value; }
				}
				text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
				try {
					const parsed = JSON.parse(text);
					if (Array.isArray(parsed.cards)) {
						allCards.push(...parsed.cards.slice(0, remaining));
					}
				} catch {
					console.warn(`[ContextManager] distillQueue batch ${i} parse failed`);
				}
			}

			return allCards.length > 0 ? allCards : null;
		} catch (err) {
			console.error('[ContextManager] distillQueue failed:', err);
			return null;
		}
	}

	// ─── Private ────────────────────────────────────────────────

	private _lastAutoDistillAt = 0;

	// ─── Multi-Turn Extraction (Step 4) ─────────────────────────

	/**
	 * Iterative multi-turn extraction for PreCompact entries.
	 * Runs two accumulators in parallel across all turns — one for conventions,
	 * one for architecture. Then does a final pass for KnowledgeCard evaluation.
	 */
	async extractMultiTurnLearnings(
		turns: Array<{ user: string; assistant: string }>,
		projectId: string,
	): Promise<void> {
		if (!turns.length) { return; }

		const shouldExtractConvs = ConfigurationManager.autoLearnExtractConventions;
		const shouldExtractNotes = ConfigurationManager.autoLearnExtractWorkingNotes;
		if (!shouldExtractConvs && !shouldExtractNotes) { return; }

		try {
			const model = await this._getModel();
			if (!model) { return; }

			const convAcc: { conventions: any[]; relationships: any[] } = { conventions: [], relationships: [] };

			// Process each turn — convention extraction per turn
			for (const turn of turns) {
				const turnText = `User: ${turn.user.substring(0, 1500)}\nAssistant: ${turn.assistant.substring(0, 1500)}`;

				const convResult = await this._llmExtract(model, CAPTURE_EXTRACTION_PROMPT, [
					`Learned so far: ${JSON.stringify(convAcc)}`,
					`New turn:\n${turnText}`,
					'Add NEW items only. No repeats.',
				].join('\n\n'));

				// Merge convention results (dedup by title)
				if (convResult?.conventions?.length) {
					for (const conv of convResult.conventions) {
						if (!convAcc.conventions.some(c => c.title?.toLowerCase() === conv.title?.toLowerCase())) {
							convAcc.conventions.push(conv);
						}
					}
				}
				if (convResult?.relationships?.length) {
					for (const rel of convResult.relationships) {
						if (!convAcc.relationships.some(r => r.subject?.toLowerCase() === rel.subject?.toLowerCase())) {
							convAcc.relationships.push(rel);
						}
					}
				}
			}

			// --- Save results ---
			let conventionsCreated = 0;
			let notesCreated = 0;

			const validCategories = new Set(['architecture', 'naming', 'patterns', 'testing', 'tooling', 'pitfalls']);

			// Save conventions (only if setting enabled)
			if (shouldExtractConvs) {
				for (const conv of convAcc.conventions.slice(0, 5)) {
					if (!conv?.title || !conv?.content || !validCategories.has(conv.category)) { continue; }
					if (conv.title.length < 5 || conv.content.length < 10) { continue; }
					const existing = this._projectManager.getConventions(projectId);
					if (existing.some(c => c.title.toLowerCase() === conv.title.toLowerCase())) { continue; }
					const saved = await this._projectManager.addConvention(
						projectId, conv.category, conv.title, conv.content, 'inferred',
						'auto-captured from multi-turn PreCompact'
					);
					if (saved) { conventionsCreated++; }
				}
			}

			// Save relationships as working notes (only if setting enabled)
			if (shouldExtractNotes) {
				for (const rel of convAcc.relationships.slice(0, 3)) {
					if (!rel?.subject || !rel?.insight) { continue; }
					const existing = this._projectManager.getWorkingNotes(projectId);
					if (existing.some(n => n.subject.toLowerCase() === rel.subject.toLowerCase())) { continue; }
					const saved = await this._projectManager.addWorkingNote(
						projectId, rel.subject, rel.insight,
						rel.relatedFiles || [], rel.relatedSymbols || [],
						'auto-captured from multi-turn PreCompact'
					);
					if (saved) { notesCreated++; }
				}
			}

			// Report
			if (conventionsCreated > 0 || notesCreated > 0) {
				const parts: string[] = [];
				if (conventionsCreated > 0) { parts.push(`${conventionsCreated} convention${conventionsCreated > 1 ? 's' : ''}`); }
				if (notesCreated > 0) { parts.push(`${notesCreated} note${notesCreated > 1 ? 's' : ''}`); }
				bgTasks.logCompletedTask(
					'auto-capture',
					`Auto-captured: ${parts.join(', ')} (${turns.length} turns)`,
					`Multi-turn extraction: ${parts.join(', ')}`,
					[{ timestamp: Date.now(), type: 'text' as const, content: `Multi-turn auto-capture: ${parts.join(', ')}` }],
				);
				console.log(`[ContextManager] Multi-turn extraction (${turns.length} turns): ${parts.join(', ')}`);
			}
		} catch (err) {
			console.debug('[ContextManager] Multi-turn extraction failed:', err);
		}
	}

	// ─── Auto-Distill (Step 5) ──────────────────────────────────

	/**
	 * Background distillation — reuses existing distillObservations() logic but
	 * auto-saves results above confidence thresholds. Rate-limited and guarded.
	 */
	async distillAndSaveBackground(projectId: string): Promise<void> {
		// Guard: check if auto-distill is enabled
		if (!ConfigurationManager.autoDistillEnabled) { return; }

		// Guard: minimum observations
		const recent = this.getRecentObservations(2 * 60 * 60 * 1000, projectId); // 2 hours, project-scoped
		if (recent.length < 4) { return; }

		// Guard: rate limit
		const intervalMs = ConfigurationManager.autoDistillIntervalMinutes * 60 * 1000;
		const now = Date.now();
		if (now - this._lastAutoDistillAt < intervalMs) { return; }
		this._lastAutoDistillAt = now;

		const shouldExtractConvs = ConfigurationManager.autoLearnExtractConventions;
		const shouldExtractNotes = ConfigurationManager.autoLearnExtractWorkingNotes;
		if (!shouldExtractConvs && !shouldExtractNotes) { return; }

		try {
			const result = await this.distillObservations(40, projectId);
			if (!result) { return; }

			let conventionsCreated = 0;
			let notesCreated = 0;

			// Auto-save conventions (only if setting enabled)
			if (shouldExtractConvs) {
				for (const conv of result.conventions.slice(0, 3)) {
					if (!conv?.title || !conv?.content) { continue; }
					const existing = this._projectManager.getConventions(projectId);
					if (existing.some(c => c.title.toLowerCase() === conv.title.toLowerCase())) { continue; }
					const saved = await this._projectManager.addConvention(
						projectId,
						(conv.category || 'patterns') as any,
						conv.title, conv.content, 'inferred',
						'auto-distilled at compaction checkpoint'
					);
					if (saved) { conventionsCreated++; }
				}
			}

			// Auto-save working notes (only if setting enabled)
			if (shouldExtractNotes) {
				for (const note of result.workingNotes.slice(0, 3)) {
					if (!note?.subject || !note?.insight) { continue; }
					const existing = this._projectManager.getWorkingNotes(projectId);
					if (existing.some(n => n.subject.toLowerCase() === note.subject.toLowerCase())) { continue; }
					const saved = await this._projectManager.addWorkingNote(
						projectId, note.subject, note.insight,
						note.relatedFiles || [], [],
						'auto-distilled at compaction checkpoint'
					);
					if (saved) { notesCreated++; }
				}
			}

			if (conventionsCreated > 0 || notesCreated > 0) {
				const parts: string[] = [];
				if (conventionsCreated > 0) { parts.push(`${conventionsCreated} convention${conventionsCreated > 1 ? 's' : ''}`); }
				if (notesCreated > 0) { parts.push(`${notesCreated} note${notesCreated > 1 ? 's' : ''}`); }
				bgTasks.logCompletedTask(
					'auto-capture',
					`Auto-distilled: ${parts.join(', ')}`,
					`Background distillation at compaction checkpoint`,
					[{ timestamp: Date.now(), type: 'text' as const, content: `Auto-distilled: ${parts.join(', ')}` }],
				);
			}
		} catch (err) {
			console.debug('[ContextManager] Auto-distill failed:', err);
		}
	}

	// ─── Private Helpers ────────────────────────────────────────

	/** Get a language model for extraction. */
	private async _getModel(): Promise<vscode.LanguageModelChat | null> {
		const modelFamily = ConfigurationManager.autoLearnModelFamily;
		const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
		const models = await vscode.lm.selectChatModels(selector);
		return models.length ? models[0] : null;
	}

	/** Run a single LLM extraction call with system + user messages. */
	private async _llmExtract(model: vscode.LanguageModelChat, systemPrompt: string, userContent: string): Promise<any> {
		try {
			const messages = [
				vscode.LanguageModelChatMessage.User(systemPrompt),
				vscode.LanguageModelChatMessage.User(userContent),
			];
			const response = await Promise.race([
				model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token),
				new Promise<null>((_, reject) =>
					setTimeout(() => reject(new Error('LLM extraction timeout')), LLM_TIMEOUT_MS)
				),
			]);
			if (!response) { return null; }

			let text = '';
			for await (const part of (response as any).stream ?? (response as any).text ?? []) {
				if (typeof part === 'string') { text += part; }
				else if (part?.value) { text += part.value; }
			}
			text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
			return JSON.parse(text);
		} catch {
			return null;
		}
	}

	/**
	 * Anchor extraction — runs ANCHOR_EXTRACTION_PROMPT per card produced.
	 * Identifies load-bearing tool results from the session turns.
	 */
	private async _extractAnchors(
		model: vscode.LanguageModelChat,
		card: { title: string; content: string },
		turns: Array<{ user: string; assistant: string }>,
	): Promise<AnchorStub[]> {
		try {
			const stubLines = ConfigurationManager.contextStubLines;
			// Build condensed tool call context from turns
			// Look for patterns like [tool_name] or tool call references in assistant text
			const toolContext = turns.map((t, i) => {
				const lines = t.assistant.split('\n').slice(0, 20);
				return `Turn ${i + 1}:\n${lines.join('\n').substring(0, 500)}`;
			}).join('\n\n');

			const userContent = [
				`Knowledge Card Title: ${card.title}`,
				`Knowledge Card Content: ${card.content}`,
				'',
				`Session turns (assistant responses, summarized):`,
				toolContext,
			].join('\n');

			const result = await this._llmExtract(model, ANCHOR_EXTRACTION_PROMPT, userContent);
			if (!result?.anchors?.length) { return []; }

			const now = Date.now();
			return result.anchors
				.filter((a: any) => a?.filePath && a?.stubContent)
				.slice(0, 5)
				.map((a: any) => ({
					filePath: a.filePath,
					symbolName: a.symbolName || undefined,
					startLine: a.startLine || undefined,
					endLine: a.endLine || undefined,
					stubContent: typeof a.stubContent === 'string'
						? a.stubContent.split('\n').slice(0, stubLines).join('\n')
						: '',
					capturedAt: now,
					verified: true,
				} as AnchorStub));
		} catch {
			return [];
		}
	}

	private _indexObservation(obs: Observation, projectId: string): void {
		try {
			this._searchIndex?.indexObservation?.({
				id: obs.id,
				projectId,
				type: obs.type,
				prompt: obs.prompt,
				responseSummary: obs.responseSummary,
				participant: obs.participant,
				filesReferenced: obs.filesReferenced.join(', '),
				toolCalls: obs.toolCalls?.map(tc => tc.name).join(', ') || '',
				timestamp: obs.timestamp,
			});
		} catch { /* non-critical */ }
	}

	private async _extractLearningsBackground(
		promptText: string,
		responseText: string,
		projectId: string,
	): Promise<void> {
		try {
			const model = await this._getModel();
			if (!model) { return; }

			const responseExcerpt = responseText.length > 1500
				? responseText.substring(0, 1500) + '\n[...truncated]'
				: responseText;

			const userMessage = [
				`User asked: ${promptText.substring(0, 300)}`,
				`\nAI Response:\n${responseExcerpt}`,
			].join('\n');

			// Run convention extraction (single LLM call, no card extraction)
			const shouldExtractConvs = ConfigurationManager.autoLearnExtractConventions;
			const shouldExtractNotes = ConfigurationManager.autoLearnExtractWorkingNotes;
			if (!shouldExtractConvs && !shouldExtractNotes) { return; }

			const parsed = await this._llmExtract(model, CAPTURE_EXTRACTION_PROMPT, userMessage);
			if (!parsed || typeof parsed !== 'object') { return; }

			const validCategories = new Set(['architecture', 'naming', 'patterns', 'testing', 'tooling', 'pitfalls']);
			let conventionsCreated = 0;
			let notesCreated = 0;

			if (shouldExtractConvs) {
				for (const conv of (parsed.conventions || []).slice(0, 2)) {
					if (!conv?.title || !conv?.content || !validCategories.has(conv.category)) { continue; }
					if (conv.title.length < 5 || conv.content.length < 10) { continue; }
					const existing = this._projectManager.getConventions(projectId);
					if (existing.some(c => c.title.toLowerCase() === conv.title.toLowerCase())) { continue; }
					const saved = await this._projectManager.addConvention(
						projectId, conv.category, conv.title, conv.content, 'inferred',
						'auto-captured from chat interaction'
					);
					if (saved) { conventionsCreated++; }
				}
			}

			if (shouldExtractNotes) {
				for (const rel of (parsed.relationships || []).slice(0, 1)) {
					if (!rel?.subject || !rel?.insight) { continue; }
					if (rel.subject.length < 3 || rel.insight.length < 15) { continue; }
					const existing = this._projectManager.getWorkingNotes(projectId);
					if (existing.some(n => n.subject.toLowerCase() === rel.subject.toLowerCase())) { continue; }
					const saved = await this._projectManager.addWorkingNote(
						projectId, rel.subject, rel.insight,
						rel.relatedFiles || [], rel.relatedSymbols || [],
						'auto-captured from chat interaction'
					);
					if (saved) { notesCreated++; }
				}
			}

			if (conventionsCreated > 0 || notesCreated > 0) {
				const parts: string[] = [];
				if (conventionsCreated > 0) { parts.push(`${conventionsCreated} convention${conventionsCreated > 1 ? 's' : ''}`); }
				if (notesCreated > 0) { parts.push(`${notesCreated} note${notesCreated > 1 ? 's' : ''}`); }
				bgTasks.logCompletedTask(
					'auto-capture',
					`Auto-captured: ${parts.join(', ')}`,
					`Extracted from chat: ${parts.join(', ')}`,
					[{ timestamp: Date.now(), type: 'text' as const, content: `Auto-capture learned: ${parts.join(', ')}` }],
				);
				console.log(`[ContextManager] Auto-capture learned: ${parts.join(', ')}`);
			}
		} catch (err) {
			console.debug('[ContextManager] Auto-capture LLM extraction failed:', err);
		}
	}
}

// ─── Utility Functions ──────────────────────────────────────────

function summarizeResponse(text: string): string {
	const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('# '));
	const summary = lines.slice(0, 8).join(' ').substring(0, 500);
	return summary + (text.length > 500 ? '…' : '');
}

function formatRelativeTime(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) { return 'just now'; }
	if (diffMin < 60) { return `${diffMin}m ago`; }
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) { return `${diffHr}h ago`; }
	const diffDay = Math.floor(diffHr / 24);
	return `${diffDay}d ago`;
}
