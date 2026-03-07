/**
 * Data models for Projects, TODOs, Cache, and Knowledge Cards
 */

export interface PromptInjection {
	customInstruction: string;   // Custom message prepended to the injected block
	includeFullContent: boolean; // true = inject full card body; false = title + ID only
	oneShotMode?: boolean;       // true = deselect cards after they are injected once
	// Card selection is driven by project.selectedCardIds (Knowledge tab checkboxes)
}

export interface ToolSharingConfig {
	enabled: boolean;              // Master toggle for LM tool sharing
	shareProjectMeta: boolean;     // Share project name, description, goals, conventions
	shareKnowledgeCards: boolean;  // Share selected knowledge cards
	shareCache: boolean;           // Share selected cache entries
	shareTodos: boolean;           // Share active TODOs
}

export const DEFAULT_TOOL_SHARING_CONFIG: ToolSharingConfig = {
	enabled: true,
	shareProjectMeta: true,
	shareKnowledgeCards: true,
	shareCache: true,
	shareTodos: false,
};

export interface Project {
	id: string;
	name: string;
	description: string;
	rootPaths: string[];           // Folders this project covers
	created: number;               // timestamp
	lastAccessed: number;          // timestamp
	context: ProjectContext;
	todos: Todo[];
	knowledgeCards: KnowledgeCard[];      // Saved knowledge/context snippets
	knowledgeFolders?: KnowledgeFolder[]; // User-defined folders for organizing knowledge cards
	selectedCardIds: string[];            // Cards selected to include in prompts
	contextEnabled: boolean;              // Whether to include project context in prompts
	toolSharingConfig?: ToolSharingConfig; // Controls what the #projectContext LM tool shares
	promptInjection?: PromptInjection;     // Cards/instruction injected into every prompt via session-context.txt
	conventions?: Convention[];           // Learned project conventions (architecture, patterns, etc.)
	selectedConventionIds?: string[];     // Conventions selected for prompt injection
	toolHints?: ToolHint[];               // Learned tool usage hints (search patterns, etc.)
	selectedToolHintIds?: string[];       // Tool hints selected for prompt injection
	workingNotes?: WorkingNote[];         // Agent exploration memory (insights, relationships)
	autoLearnDiscardCounts?: Record<string, number>; // Tracks discard counts per signal category for feedback loop
	cardQueue?: QueuedCardCandidate[];    // Pending card candidates awaiting user review/approval
	workflows?: CustomWorkflow[];         // User-defined AI workflows
}

// ─── Custom Workflow Types ─────────────────────────────────────

export type WorkflowTrigger = 'auto-queue' | 'manual' | 'both' | 'convention-learned' | 'card-created' | 'card-updated' | 'observation-created';
export type WorkflowOutputAction = 'update-card' | 'create-card' | 'append-collector';

export interface WorkflowRunRecord {
	timestamp: number;
	status: 'success' | 'error' | 'skipped';
	outputPreview?: string;               // First 200 chars of AI output
	error?: string;
}

export interface CustomWorkflow {
	id: string;
	name: string;
	promptTemplate: string;               // Supports {{variable}} placeholders
	trigger: WorkflowTrigger;             // When the workflow fires
	outputAction: WorkflowOutputAction;   // What to do with AI result
	targetCardId?: string;                // For 'update-card' & 'append-collector'
	maxItems?: number;                    // Max items per collection variable (default 20)
	skipPattern?: string;                 // Regex — if AI output matches, skip the output action
	triggerFilter?: string;               // Regex — auto-triggers only fire if prompt+response matches
	enabled: boolean;
	created: number;
	lastRun?: number;
	lastRunStatus?: 'success' | 'error' | 'skipped';
	lastRunError?: string;
	runCount: number;
	runHistory?: WorkflowRunRecord[];     // Last N execution records
}

export function createWorkflow(
	name: string,
	promptTemplate: string,
	trigger: WorkflowTrigger,
	outputAction: WorkflowOutputAction,
	targetCardId?: string,
	maxItems?: number,
	skipPattern?: string,
	triggerFilter?: string,
): CustomWorkflow {
	return {
		id: generateId(),
		name,
		promptTemplate,
		trigger,
		outputAction,
		targetCardId,
		maxItems: maxItems ?? 20,
		skipPattern: skipPattern || undefined,
		triggerFilter: triggerFilter || undefined,
		enabled: true,
		created: Date.now(),
		runCount: 0,
		runHistory: [],
	};
}

export interface AnchorStub {
	filePath: string;
	symbolName?: string;           // e.g. "EmbeddedBrowserImpl"
	startLine?: number;
	endLine?: number;
	stubContent: string;           // Verbatim lines from original tool result
	capturedAt: number;            // Timestamp — for staleness dating
	verified: boolean;             // true = confirmed present at capture time
}

export interface KnowledgeCard {
	id: string;
	title: string;
	content: string;               // The actual knowledge/context
	folderId?: string;             // Optional folder assignment within a project
	trackToolUsage?: boolean;      // Opt-in: whether to learn and attach successful tool patterns for this card
	toolUsages?: KnowledgeToolUsage[]; // Learned successful tool usage patterns scoped to this card
	category: 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other';
	tags: string[];                // For filtering/searching
	created: number;
	updated: number;
	source?: string;               // Optional: where this knowledge came from (e.g., file path, URL)
	referenceFiles?: string[];     // File paths to include as context when this card is selected
	// Usage analytics
	selectionCount?: number;       // How many times this card has been selected for context
	injectionCount?: number;       // How many times this card was injected into a prompt
	lastSelectedAt?: number;       // Timestamp of last selection
	// Hook-based knowledge extraction (Steps 10-11)
	pinned?: boolean;              // Pinned cards appear first in index; default false
	includeInContext?: boolean;    // Shown in knowledge_index; default true
	archived?: boolean;            // Hidden from index and normal views; default false
	isGlobal?: boolean;            // Global cards are injected into all projects' context
	anchors?: AnchorStub[];        // Grounded code stubs from anchor extraction
}

export interface KnowledgeToolUsage {
	toolName: string;
	pattern: string;
	example?: string;
	successCount: number;
	lastUsed: number;
}

// ─── Card Queue Types ──────────────────────────────────────────

export interface QueuedCardCandidate {
	id: string;
	prompt: string;                // User's original question
	response: string;              // Model's response (truncated to ~3000 chars)
	participant: string;           // Chat participant (e.g., 'copilot', 'contextManager')
	toolCalls?: ToolCallRecord[];  // Tool invocations if any
	suggestedTitle: string;        // LLM-suggested title
	suggestedCategory: QueuedCardCandidate['category'];
	suggestedContent: string;      // Extracted card-worthy content
	reasoning: string;             // Why this is card-worthy
	confidenceScore: number;       // 0.0-1.0 how card-worthy this is
	createdAt: number;
	category?: 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other';
}

export interface ToolCallRecord {
	toolName: string;
	input: string;                 // Serialized input
	output: string;                // Serialized output (truncated)
}

export interface KnowledgeFolder {
	id: string;
	name: string;
	parentFolderId?: string;
	created: number;
	updated: number;
}

export interface ProjectContext {
	// User-provided context
	goals: string;                 // What is this project about?
	conventions: string;           // Coding conventions, patterns
	keyFiles: string[];            // Important files to always consider
	
	// Auto-discovered context (loaded on demand)
	copilotInstructions?: string;  // From .github/copilot-instructions.md
	readme?: string;               // From README.md
}

export interface Todo {
	id: string;
	title: string;
	description: string;
	status: 'pending' | 'in-progress' | 'completed' | 'failed';
	priority: 'low' | 'medium' | 'high';
	created: number;               // timestamp
	completed?: number;            // timestamp
	notes?: string;                // User's own thoughts/instructions to steer the agent
	linkedKnowledgeCardId?: string; // Knowledge card created/refined by this TODO's runs
	
	// AI execution tracking
	agentRuns: AgentRun[];
}

export interface AgentRun {
	id: string;
	todoId: string;
	startTime: number;
	endTime?: number;
	status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
	summary?: string;
	
	// Full history for audit/user reference (not fed to LLM)
	conversationHistory: SerializedMessage[];
	lastResponseText: string;
}

/**
 * Serialized chat message for persistence.
 * VS Code's LanguageModelChatMessage can't be directly serialized.
 */
export interface SerializedMessage {
	role: 'user' | 'assistant';
	content: string;
	// Tool calls/results are stored as JSON strings since they contain complex objects
	toolCalls?: string;      // JSON serialized tool call parts
	toolResults?: string;    // JSON serialized tool result parts
}

// ─── Project Intelligence Types ───────────────────────────────

export interface Convention {
	id: string;
	category: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls';
	title: string;
	content: string;
	learnedFrom?: string;
	confidence: 'observed' | 'inferred';
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface ToolHint {
	id: string;
	toolName: string;
	pattern: string;
	antiPattern?: string;
	example: string;
	useCount: number;
	createdAt: number;
	updatedAt: number;
}

export interface WorkingNote {
	id: string;
	subject: string;
	insight: string;
	relatedFiles: string[];
	relatedSymbols: string[];
	discoveredWhile?: string;
	confidence: 'inferred' | 'observed';
	enabled: boolean;
	taskId?: string;
	createdAt: number;
	updatedAt: number;
	staleness: 'fresh' | 'possibly-stale' | 'stale';
}

export interface CachedExplanation {
	id: string;
	symbolName: string;
	filePath: string;
	lineNumber?: number;
	type: 'explain' | 'usage' | 'relationships';
	explanation: string;
	citations: string[];           // Files referenced in explanation
	timestamp: number;
	projectId?: string;
}

// Helper to create new project with defaults
export function createProject(name: string, rootPaths: string[]): Project {
	return {
		id: generateId(),
		name,
		description: '',
		rootPaths,
		created: Date.now(),
		lastAccessed: Date.now(),
		context: {
			goals: '',
			conventions: '',
			keyFiles: []
		},
		todos: [],
		knowledgeCards: [],
		knowledgeFolders: [],
		selectedCardIds: [],
		contextEnabled: true,  // Include context by default
		autoLearnDiscardCounts: {},
		cardQueue: [],
	};
}

// Helper to create queued card candidate
export function createQueuedCard(
	prompt: string,
	response: string,
	participant: string,
	suggestedTitle: string,
	suggestedCategory: QueuedCardCandidate['category'],
	suggestedContent: string,
	reasoning: string,
	confidenceScore: number,
	toolCalls?: ToolCallRecord[],
): QueuedCardCandidate {
	return {
		id: generateId(),
		prompt,
		response,
		participant,
		toolCalls: toolCalls || [],
		suggestedTitle,
		suggestedCategory,
		suggestedContent,
		reasoning,
		confidenceScore,
		createdAt: Date.now(),
	};
}

// Helper to create new todo
export function createTodo(title: string, description: string = ''): Todo {
	return {
		id: generateId(),
		title,
		description,
		status: 'pending',
		priority: 'medium',
		created: Date.now(),
		agentRuns: []
	};
}

// Helper to create new knowledge card
export function createKnowledgeCard(
	title: string,
	content: string,
	category: KnowledgeCard['category'] = 'note',
	tags: string[] = [],
	source?: string,
	referenceFiles?: string[],
	anchors?: AnchorStub[],
): KnowledgeCard {
	return {
		id: generateId(),
		title,
		content,
		category,
		tags,
		created: Date.now(),
		updated: Date.now(),
		source,
		referenceFiles,
		pinned: false,
		includeInContext: true,
		archived: false,
		anchors: anchors || [],
	};
}

// Helper to create new agent run
export function createAgentRun(todoId: string): AgentRun {
	return {
		id: generateId(),
		todoId,
		startTime: Date.now(),
		status: 'running',
		conversationHistory: [],
		lastResponseText: '',
	};
}

// Helper to create a convention
export function createConvention(
	category: Convention['category'],
	title: string,
	content: string,
	confidence: Convention['confidence'] = 'observed',
	learnedFrom?: string,
): Convention {
	return {
		id: generateId(),
		category, title, content, confidence, learnedFrom,
		enabled: true,
		createdAt: Date.now(), updatedAt: Date.now(),
	};
}

// Helper to create a tool hint
export function createToolHint(
	toolName: string,
	pattern: string,
	example: string,
	antiPattern?: string,
): ToolHint {
	return {
		id: generateId(),
		toolName, pattern, example, antiPattern,
		useCount: 0,
		createdAt: Date.now(), updatedAt: Date.now(),
	};
}

// Helper to create a working note
export function createWorkingNote(
	subject: string,
	insight: string,
	relatedFiles: string[] = [],
	relatedSymbols: string[] = [],
	discoveredWhile?: string,
): WorkingNote {
	return {
		id: generateId(),
		subject, insight, relatedFiles, relatedSymbols, discoveredWhile,
		confidence: 'inferred',
		enabled: true,
		createdAt: Date.now(), updatedAt: Date.now(),
		staleness: 'fresh',
	};
}

// Simple ID generator
export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}



// ─── Workflow Template Variables ───────────────────────────────
// Queue:       {{queue.prompt}}, {{queue.response}}, {{queue.participant}}, {{queue.toolCalls}}
// Card:        {{card.title}}, {{card.content}}, {{card.tags}}
// Project:     {{project.name}}, {{project.description}}, {{project.conventions}}
// Collections: {{cards.all}}, {{cards.selected}}, {{toolHints.all}}, {{workingNotes.all}},
//              {{observations.recent}}, {{conventions.all}}
// Event:       {{convention.title}}, {{convention.content}},
//              {{observation.summary}}, {{observation.files}}

export type BackgroundTaskType =
	| 'auto-learn'     // Auto-learning pipeline
	| 'auto-capture'   // Auto-capture from chat interactions
	| 'query'          // Ad-hoc question to the background agent
	| 'audit'          // Knowledge card audit
	| 'map'            // Module architectural map
	| 'knowledge'      // Knowledge card generation
	| 'handoff'        // Handoff document generation
	| 'custom';        // User-defined task

export type BackgroundTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTaskStep {
	timestamp: number;
	type: 'tool-call' | 'tool-result' | 'thinking' | 'text' | 'error';
	content: string;
}

export interface BackgroundTask {
	id: string;
	type: BackgroundTaskType;
	title: string;
	prompt: string;
	/** Serialized context from chat session (last exchange) */
	chatContext?: string;
	status: BackgroundTaskStatus;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	/** Live steps for progress tracking */
	steps: BackgroundTaskStep[];
	/** Final result text */
	result?: string;
	/** Error message if failed */
	error?: string;
	/** ID of knowledge card created (if applicable) */
	createdCardId?: string;
}

export function createBackgroundTask(
	type: BackgroundTaskType,
	title: string,
	prompt: string,
	chatContext?: string,
): BackgroundTask {
	return {
		id: generateId(),
		type,
		title,
		prompt,
		chatContext,
		status: 'queued',
		createdAt: Date.now(),
		steps: [],
	};
}
