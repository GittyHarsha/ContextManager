/**
 * /knowledge prompt — research a topic and generate a knowledge card.
 */
import {
	BasePromptElementProps,
	PromptElement,
	PromptSizing,
	UserMessage,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../config';
import { History, PromptReferences, ReferenceFiles, ToolCallRound, ToolCalls } from './components';

export interface KnowledgePromptProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	topic: string;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	projectContext: string;
	workspacePaths: string[];
	referenceFiles: string[];
}

export class KnowledgePrompt extends PromptElement<KnowledgePromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
			const defaultInstructions = `You are a codebase expert. Research the given topic and create a comprehensive knowledge card.

Use tools to thoroughly search and read the codebase — call as many tools as you need to build a comprehensive understanding. Follow imports, read related files, search for usages and patterns.

Once you have enough information, output the card.`;

			const instructions = ConfigurationManager.getEffectivePrompt('research', defaultInstructions);

			return (
			<>
				<UserMessage>
					{instructions}<br /><br />
					## Workspace Root Paths<br />
					{this.props.workspacePaths.map(p => `- ${p}`).join('\n')}<br /><br />
					Use these paths when calling search tools.<br /><br />
					{this.props.projectContext && <>
						## Project Context<br />
						The following is user-curated context including project goals, conventions, knowledge cards, and cached code explanations. Use this to inform your research.<br /><br />
						{this.props.projectContext}<br /><br />
					</>}
					<ReferenceFiles filePaths={this.props.referenceFiles} priority={25} />
					Output format:<br /><br />
					---KNOWLEDGE_CARD_START---<br />
					TITLE: [concise title]<br />
					CATEGORY: [architecture | pattern | convention | explanation | note | other]<br />
					TAGS: [comma-separated tags]<br /><br />
					[Comprehensive explanation with file paths and code references]<br />
					---KNOWLEDGE_CARD_END---
				</UserMessage>
				<History context={this.props.context} priority={10} />
				<PromptReferences references={this.props.request.references || []} priority={20} />
				<UserMessage>
					## Topic to Research<br />
					{this.props.topic}
				</UserMessage>
				<ToolCalls
					toolCallRounds={this.props.toolCallRounds}
					toolInvocationToken={this.props.request.toolInvocationToken}
					toolCallResults={this.props.toolCallResults}
				/>
			</>
		);
	}
}
