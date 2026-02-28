/**
 * /todo prompt — autonomous TODO execution with full tool access.
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
import { AgentRun, Todo } from '../projects/types';

export interface TodoPromptProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	todo: Todo;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	projectContext: string;
	workspacePaths: string[];
	referenceFiles: string[];
	isResume: boolean;
	agentRun: AgentRun;
	additionalInstructions?: string;
}

export class TodoPrompt extends PromptElement<TodoPromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		const { todo, projectContext, workspacePaths, isResume, agentRun, additionalInstructions } = this.props;

		const defaultInstructions = `You are an autonomous coding agent that completes TODOs with full access to the codebase.

## Critical Rules
- NEVER guess or assume — only state what you verify from the code
- Use tools first, then explain
- Cite file paths and line numbers for every claim
- NEVER fabricate file paths — use search tools to discover them
- Show your reasoning step by step`;

		const instructions = ConfigurationManager.getEffectivePrompt('todo', defaultInstructions);

		return (
			<>
				<UserMessage>
					{instructions}<br /><br />
					## Workspace Root Paths<br />
					{workspacePaths.map(p => `- ${p}`).join('\n')}<br /><br />
					All files are inside these directories.<br />
					{projectContext && <>
						<br />## Project Context (user-curated — use this to inform your work, do NOT re-search it)<br />
						This includes project goals, conventions, knowledge cards, and cached code explanations the user selected as relevant context.<br /><br />
						{projectContext}<br />
					</>}
					<ReferenceFiles filePaths={this.props.referenceFiles} priority={25} />
				</UserMessage>
				<History context={this.props.context} priority={10} />
				<PromptReferences references={this.props.request.references || []} priority={20} />
				<UserMessage>
					## TODO<br />
					{todo.description || todo.title}<br />
					{todo.notes && <>
						<br />## User Notes<br />
						{todo.notes}<br />
					</>}
					{additionalInstructions && <>
						<br />## Additional Instructions<br />
						{additionalInstructions}<br />
					</>}
					{isResume && <>
						<br />## Resume Context<br />
						You are resuming work on this TODO. Do NOT repeat previous work. Review the conversation history above and continue from where you left off.<br />
					</>}
					{!isResume && <>
						<br />## Instructions<br />
						Complete this TODO. Use tools to search, read, and understand the code. Cite file paths as you go.
					</>}
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
