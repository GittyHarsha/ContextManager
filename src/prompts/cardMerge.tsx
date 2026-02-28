/**
 * Card merge detection prompt — checks if a new knowledge card overlaps with existing cards
 * and suggests merge strategies.
 */
import {
	BasePromptElementProps,
	PromptElement,
	PromptSizing,
	UserMessage,
} from '@vscode/prompt-tsx';

export interface CardMergePromptProps extends BasePromptElementProps {
	newCardTitle: string;
	newCardContent: string;
	newCardCategory: string;
	existingCards: Array<{
		id: string;
		title: string;
		content: string;
		category: string;
	}>;
}

export class CardMergePrompt extends PromptElement<CardMergePromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		const { newCardTitle, newCardContent, newCardCategory, existingCards } = this.props;

		const systemInstructions = `You detect semantic overlap between knowledge cards and suggest merge strategies.

Analyze the NEW card against EXISTING cards to determine if they cover similar topics.

Rules:
- Overlap is HIGH (>0.8) if cards explain the same concept/pattern/architecture with substantial content similarity
- Overlap is MEDIUM (0.5-0.8) if cards are related but cover different aspects
- Overlap is LOW (<0.5) if cards are unrelated or tangentially connected
- Consider semantic meaning, not just keyword overlap
- Compare within same category first, then across categories

Respond with ONLY valid JSON (no markdown fences):
{
  "overlap": "high" | "medium" | "low",
  "score": 0.0-1.0,
  "matchingCardId": "existing-card-id-or-null",
  "reasoning": "brief explanation of overlap assessment",
  "mergeStrategy": "replace_old" | "replace_new" | "merge_both" | "keep_separate",
  "mergeReasoning": "why this strategy is recommended"
}

If overlap is LOW, set matchingCardId=null and mergeStrategy="keep_separate".`;

		const existingCardsText = existingCards.map((c, idx) => 
			`### Existing Card ${idx + 1} [ID: ${c.id}]
**Title:** ${c.title}
**Category:** ${c.category}
**Content:**
${c.content.substring(0, 800)}${c.content.length > 800 ? '\n[...truncated]' : ''}`
		).join('\n\n');

		const newCardText = `### NEW Card (to be saved)
**Title:** ${newCardTitle}
**Category:** ${newCardCategory}
**Content:**
${newCardContent.substring(0, 800)}${newCardContent.length > 800 ? '\n[...truncated]' : ''}`;

		return (
			<>
				<UserMessage>
					{systemInstructions}
				</UserMessage>
				<UserMessage>
					{newCardText}

					{existingCards.length > 0 ? `\n---\n\n${existingCardsText}` : '\n(No existing cards to compare)'}
				</UserMessage>
			</>
		);
	}
}

export interface CardMergeResult {
	overlap: 'high' | 'medium' | 'low';
	score: number;
	matchingCardId: string | null;
	reasoning: string;
	mergeStrategy: 'replace_old' | 'replace_new' | 'merge_both' | 'keep_separate';
	mergeReasoning: string;
}
