/**
 * LLM prompt to detect if a chat exchange is worth saving as a knowledge card.
 * Analyzes user question + model response to identify reusable knowledge.
 */

import { PromptElement, UserMessage } from '@vscode/prompt-tsx';

export interface CardWorthinessDetectorProps {
	prompt: string;
	response: string;
	participant: string;
	toolCalls?: Array<{ toolName: string; input: string; output: string }>;
}

export interface CardWorthinessResult {
	isCardWorthy: boolean;
	reasoning: string;
	confidenceScore: number;       // 0.0-1.0
	suggestedTitle?: string;
	suggestedCategory?: 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other';
	suggestedContent?: string;     // Extracted card-worthy content (markdown)
}

export function CardWorthinessDetector(props: CardWorthinessDetectorProps): PromptElement {
	const { prompt, response, participant, toolCalls } = props;

	return (
		<>
			<UserMessage>
				You are analyzing a chat exchange to determine if it contains knowledge worth preserving as a "knowledge card" for future reference.

				## What Makes Content Card-Worthy?

				**SAVE** when the response contains:
				- **Architecture explanations**: How systems/modules are structured
				- **Design patterns**: Recurring solutions to common problems
				- **Conventions**: Project-specific coding standards, naming, file organization
				- **Complex explanations**: Deep technical details that took significant effort to produce
				- **Tool usage patterns**: Successful ways to use project-specific tools/APIs
				- **Important decisions**: Why something is done a certain way
				- **Troubleshooting insights**: Solutions to non-obvious problems
				- **Code relationships**: How components interact, dependencies, data flow

				**SKIP** when the response is:
				- Simple factual lookup (e.g., "what's in this file?")
				- Trivial operations (e.g., "rename this variable")
				- Extremely specific to a single line of code
				- Generic programming knowledge (not project-specific)
				- Status updates or confirmations without substantial content
				- Conversational chitchat or error messages

				## Additional Rules:
				- **Tool invocations** (file reads, symbol lookups, etc.) make responses MORE card-worthy if they reveal architecture/relationships
				- Responses with **code examples** that illustrate patterns are highly valuable
				- Responses that **reference multiple files/symbols** showing system structure are valuable
				- Short responses (&lt;200 chars) are rarely card-worthy unless they're critical insights

				## Chat Exchange to Analyze:

				**Chat Participant:** `{participant}`

				**User Question:**
				```
				{prompt}
				```

				**Model Response:**
				```
				{response}
				```

				{toolCalls && toolCalls.length > 0 && (
					<>
						**Tool Invocations:**
						{toolCalls.map((tc, idx) => (
							<>
								{idx + 1}. **{tc.toolName}**
								   Input: `{tc.input.substring(0, 200)}`
								   Output: {tc.output.length} chars{'\n'}
							</>
						))}
					</>
				)}

				## Your Task:

				Analyze this exchange and return JSON with the following structure:

				```json
				{{
					"isCardWorthy": true,
					"reasoning": "Brief explanation of why/why not (1-2 sentences)",
					"confidenceScore": 0.85,
					"suggestedTitle": "Title for the knowledge card (if card-worthy)",
					"suggestedCategory": "architecture | pattern | convention | explanation | note | other",
					"suggestedContent": "Extracted markdown content for the card (if card-worthy)"
				}}
				```

				**Important for `suggestedContent`:**
				- Extract ONLY the card-worthy parts (don't copy the entire response)
				- Include code examples if present
				- Be concise but complete - capture the key insight/pattern/explanation
				- Format as clean markdown
				- DO NOT include conversational fluff like "Here's the answer:"
				- Focus on the reusable knowledge

				Return ONLY valid JSON, no other text.
			</UserMessage>
		</>
	);
}
