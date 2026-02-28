/**
 * /refine prompt — refine an existing knowledge card using targeted edits.
 * Outputs specific EDIT operations (old text → new text) instead of full card replacement.
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

export interface RefineKnowledgePromptProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	existingCardId: string;
	existingTitle: string;
	cardFilePath: string;
	existingContent: string;
	existingCategory: string;
	existingTags: string[];
	instructions: string;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	projectContext: string;
	workspacePaths: string[];
	referenceFiles: string[];
}

export class RefineKnowledgePrompt extends PromptElement<RefineKnowledgePromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		const { existingCardId, existingTitle, cardFilePath, existingContent, existingCategory, existingTags, instructions: userInstructions, projectContext, workspacePaths } = this.props;

		const defaultInstructions = `You are a codebase expert refining a knowledge card.
The card's current content is shown below — do NOT call any read/search tools, you already have everything.

1. Analyse the content and the user's refinement instructions.
2. Prefer writing the COMPLETE refined content to the temp file in ONE call using contextManager_writeFile.
3. If contextManager_writeFile is unavailable, use contextManager_editKnowledgeCard with id and full content in one call.
4. For metadata-only changes (title, category, tags), use contextManager_editKnowledgeCard without the content field.

Keep your final text response to one brief sentence confirming what changed. No diffs, no summaries, no repeating content.`;

		const systemInstructions = ConfigurationManager.getEffectivePrompt('refine', defaultInstructions);

		return (
			<>
				<UserMessage>
					{systemInstructions}<br /><br />
					## Workspace Root Paths<br />
					{workspacePaths.map(p => `- ${p}`).join('\n')}<br /><br />
					{projectContext && <>
						## Project Context<br />
						{projectContext}<br /><br />
					</>}
					<ReferenceFiles filePaths={this.props.referenceFiles} priority={25} />
					## Knowledge Card to Refine<br /><br />
					**Card ID:** {existingCardId}<br />
					**Title:** {existingTitle}<br />
					**Category:** {existingCategory}<br />
					**Tags:** {existingTags.join(', ') || 'none'}<br /><br />
					### Current Content<br />
					```<br />
					{existingContent}<br />
					```<br /><br />
					Preferred path: write refined content to temp file at: `{cardFilePath}` using `contextManager_writeFile` in a single call.<br />
					Fallback path (if writeFile unavailable): call `contextManager_editKnowledgeCard` with `id: ${existingCardId}` and full `content`.<br />
					For metadata-only changes (title, category, tags), use `contextManager_editKnowledgeCard` without the content field.
				</UserMessage>
				<History context={this.props.context} priority={10} />
				<PromptReferences references={this.props.request.references || []} priority={20} />
				<UserMessage>
					## Refinement Instructions<br />
					{userInstructions}
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
