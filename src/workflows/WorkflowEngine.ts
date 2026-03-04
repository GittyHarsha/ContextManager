/**
 * WorkflowEngine — executes user-defined CustomWorkflow definitions.
 *
 * Resolves {{template}} variables in the prompt, calls the vscode.lm API,
 * and performs the configured output action (create card, update card, or
 * append to a collector card).
 */

import * as vscode from 'vscode';
import type { ProjectManager } from '../projects/ProjectManager';
import type { CustomWorkflow, QueuedCardCandidate, KnowledgeCard } from '../projects/types';
import { ConfigurationManager } from '../config';

const WORKFLOW_TIMEOUT_MS = 60_000;

// ── Context passed to a workflow run ────────────────────────────

export interface WorkflowContext {
	projectId: string;
	/** Queue item that triggered the workflow (auto-queue or manual). */
	queueItem?: QueuedCardCandidate;
	/** Card that the workflow targets (manual run on a card). */
	card?: KnowledgeCard;
}

export interface WorkflowResult {
	success: boolean;
	/** ID of the card that was created or updated. */
	cardId?: string;
	/** Raw AI output text. */
	output?: string;
	error?: string;
}

// ── Template variable resolution ────────────────────────────────

function resolveTemplate(
	template: string,
	ctx: WorkflowContext,
	projectManager: ProjectManager,
): string {
	const project = projectManager.getProject(ctx.projectId);
	const q = ctx.queueItem;
	const c = ctx.card;

	const vars: Record<string, string> = {
		'queue.prompt': q?.prompt ?? '',
		'queue.response': q?.response ?? '',
		'queue.participant': q?.participant ?? '',
		'queue.toolCalls': q?.toolCalls?.map(tc =>
			`[${tc.toolName}] input: ${tc.input}\noutput: ${tc.output}`
		).join('\n\n') ?? '',
		'card.title': c?.title ?? '',
		'card.content': c?.content ?? '',
		'card.tags': c?.tags?.join(', ') ?? '',
		'project.name': project?.name ?? '',
		'project.description': project?.description ?? '',
		'project.conventions': (project?.conventions || [])
			.filter(cv => cv.enabled !== false)
			.map(cv => `- ${cv.title}: ${cv.content}`)
			.join('\n') || '(none)',
	};

	return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key) => {
		return vars[key] ?? match;
	});
}

// ── Engine ──────────────────────────────────────────────────────

export class WorkflowEngine {
	constructor(private projectManager: ProjectManager) {}

	/**
	 * Execute a single workflow. Returns the result and updates the workflow's
	 * lastRun / lastRunStatus / runCount via ProjectManager.
	 */
	async execute(
		workflow: CustomWorkflow,
		ctx: WorkflowContext,
	): Promise<WorkflowResult> {
		const { projectId } = ctx;

		try {
			// 1. Resolve prompt template
			const prompt = resolveTemplate(workflow.promptTemplate, ctx, this.projectManager);
			if (!prompt.trim()) {
				return this._fail(workflow, projectId, 'Resolved prompt is empty — check your template variables.');
			}

			// 2. Select model
			const modelFamily = ConfigurationManager.autoLearnModelFamily;
			const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
			const models = await vscode.lm.selectChatModels(selector);
			if (!models.length) {
				return this._fail(workflow, projectId, 'No language model available.');
			}

			// 3. Send request
			const messages = [
				vscode.LanguageModelChatMessage.User(
					'You are executing a user-defined workflow for a project knowledge manager. ' +
					'Follow the instructions precisely. Return ONLY plain text output — no markdown fences, no JSON wrapper unless the user prompt specifically asks for structured output.'
				),
				vscode.LanguageModelChatMessage.User(prompt),
			];

			const cts = new vscode.CancellationTokenSource();
			const response = await Promise.race([
				models[0].sendRequest(messages, {}, cts.token),
				new Promise<null>((_, reject) =>
					setTimeout(() => { cts.cancel(); reject(new Error('Workflow LLM timeout')); }, WORKFLOW_TIMEOUT_MS)
				),
			]);
			if (!response) {
				return this._fail(workflow, projectId, 'No response from model.');
			}

			// 4. Stream response text
			let text = '';
			for await (const part of (response as any).stream ?? (response as any).text ?? []) {
				if (typeof part === 'string') { text += part; }
				else if (part?.value) { text += part.value; }
			}
			text = text.trim();
			if (!text) {
				return this._fail(workflow, projectId, 'Model returned empty response.');
			}

			// 5. Execute output action
			const result = await this._executeOutput(workflow, ctx, text);

			// 6. Record success
			await this.projectManager.updateWorkflow(projectId, workflow.id, {
				lastRun: Date.now(),
				lastRunStatus: 'success',
				lastRunError: undefined,
				runCount: (workflow.runCount || 0) + 1,
			});

			return result;
		} catch (err: any) {
			return this._fail(workflow, projectId, err?.message || String(err));
		}
	}

	/**
	 * Fire all auto-triggered workflows for a queue-item event.
	 * Runs fire-and-forget — errors are logged, not thrown.
	 */
	async fireAutoQueue(projectId: string, queueItem: QueuedCardCandidate): Promise<void> {
		const workflows = this.projectManager.getWorkflows(projectId);
		const eligible = workflows.filter(
			w => w.enabled && (w.trigger === 'auto-queue' || w.trigger === 'both')
		);
		if (!eligible.length) { return; }

		console.log(`[WorkflowEngine] Firing ${eligible.length} auto-queue workflow(s)`);
		for (const wf of eligible) {
			try {
				await this.execute(wf, { projectId, queueItem });
			} catch (err) {
				console.warn(`[WorkflowEngine] auto-queue workflow "${wf.name}" failed:`, err);
			}
		}
	}

	// ── Output Actions ──────────────────────────────────────────

	private async _executeOutput(
		workflow: CustomWorkflow,
		ctx: WorkflowContext,
		aiOutput: string,
	): Promise<WorkflowResult> {
		const { projectId } = ctx;

		switch (workflow.outputAction) {
			case 'create-card': {
				const title = this._extractTitle(aiOutput, workflow.name);
				const tags = ['workflow', workflow.name.toLowerCase().replace(/\s+/g, '-')];
				const source = `Workflow: ${workflow.name}`;
				const card = await this.projectManager.addKnowledgeCard(
					projectId, title, aiOutput, 'note', tags, source,
				);
				return { success: true, cardId: card?.id, output: aiOutput };
			}

			case 'update-card': {
				if (!workflow.targetCardId) {
					return { success: false, error: 'No target card specified for update.' };
				}
				const existing = this.projectManager.getKnowledgeCards(projectId)
					.find(c => c.id === workflow.targetCardId);
				if (!existing) {
					return { success: false, error: `Target card not found: ${workflow.targetCardId}` };
				}
				await this.projectManager.updateKnowledgeCard(projectId, workflow.targetCardId, {
					content: aiOutput,
					updated: Date.now(),
				});
				return { success: true, cardId: workflow.targetCardId, output: aiOutput };
			}

			case 'append-collector': {
				if (!workflow.targetCardId) {
					return { success: false, error: 'No collector card specified.' };
				}
				const collector = this.projectManager.getKnowledgeCards(projectId)
					.find(c => c.id === workflow.targetCardId);
				if (!collector) {
					return { success: false, error: `Collector card not found: ${workflow.targetCardId}` };
				}
				const timestamp = new Date().toLocaleString();
				const separator = `\n\n---\n_Workflow run: ${timestamp}_\n\n`;
				const newContent = collector.content
					? collector.content + separator + aiOutput
					: aiOutput;
				await this.projectManager.updateKnowledgeCard(projectId, workflow.targetCardId, {
					content: newContent,
					updated: Date.now(),
				});
				return { success: true, cardId: workflow.targetCardId, output: aiOutput };
			}

			default:
				return { success: false, error: `Unknown output action: ${workflow.outputAction}` };
		}
	}

	// ── Helpers ──────────────────────────────────────────────────

	/** Extract a short title from the first line of AI output. */
	private _extractTitle(text: string, fallback: string): string {
		const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').trim();
		if (firstLine.length > 5 && firstLine.length < 120) { return firstLine; }
		return `${fallback} — ${new Date().toLocaleDateString()}`;
	}

	/** Record a failure on the workflow and return an error result. */
	private async _fail(
		workflow: CustomWorkflow,
		projectId: string,
		error: string,
	): Promise<WorkflowResult> {
		console.warn(`[WorkflowEngine] Workflow "${workflow.name}" failed: ${error}`);
		await this.projectManager.updateWorkflow(projectId, workflow.id, {
			lastRun: Date.now(),
			lastRunStatus: 'error',
			lastRunError: error,
		}).catch(() => {});
		return { success: false, error };
	}
}
