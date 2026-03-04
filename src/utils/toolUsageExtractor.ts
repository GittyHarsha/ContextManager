/**
 * Shared tool-usage extraction utilities.
 *
 * Used to record tool-call patterns on knowledge cards that
 * have `trackToolUsage` enabled.
 */

import { KnowledgeToolUsage } from '../projects/types';

/** Minimal shape needed — works with both ToolLoopResult and ToolCallsMetadata */
interface ToolRoundsLike {
	toolCallRounds?: Array<{
		toolCalls?: Array<{ name: string; input?: unknown }>;
	}>;
}

export function extractPatternFromToolInput(input: unknown): { pattern: string; example?: string } {
	if (input === undefined || input === null) {
		return { pattern: 'called without explicit arguments' };
	}

	if (typeof input === 'string') {
		const value = input.trim();
		return {
			pattern: value ? `input="${value.substring(0, 140)}"` : 'called with empty string input',
			example: value ? value.substring(0, 140) : undefined,
		};
	}

	if (typeof input !== 'object') {
		return { pattern: `input=${String(input)}` };
	}

	const obj = input as Record<string, unknown>;
	const preferredKeys = ['query', 'path', 'filePath', 'symbolName', 'command', 'title', 'url', 'topic', 'name'];
	for (const key of preferredKeys) {
		const raw = obj[key];
		if (typeof raw === 'string' && raw.trim()) {
			const value = raw.trim().substring(0, 140);
			return { pattern: `${key}="${value}"`, example: value };
		}
	}

	const summary = Object.entries(obj)
		.filter(([, value]) => value !== undefined && value !== null)
		.slice(0, 2)
		.map(([key, value]) => `${key}=${typeof value === 'string' ? `"${value.substring(0, 80)}"` : String(value)}`)
		.join(', ');

	return {
		pattern: summary || 'called with structured object input',
		example: summary || undefined,
	};
}

export function extractToolUsages(result: ToolRoundsLike): KnowledgeToolUsage[] {
	const merged = new Map<string, KnowledgeToolUsage>();
	const now = Date.now();

	for (const round of result.toolCallRounds || []) {
		for (const toolCall of round.toolCalls || []) {
			const toolName = toolCall.name.replace(/^contextManager_/, '');
			const { pattern, example } = extractPatternFromToolInput((toolCall as any).input);
			const key = `${toolName}::${pattern}`;
			const existing = merged.get(key);
			if (existing) {
				existing.successCount += 1;
				existing.lastUsed = now;
				if (!existing.example && example) {
					existing.example = example;
				}
			} else {
				merged.set(key, {
					toolName,
					pattern,
					example,
					successCount: 1,
					lastUsed: now,
				});
			}
		}
	}

	return Array.from(merged.values());
}
