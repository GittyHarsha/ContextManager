/**
 * /chat prompt — conversational mode with tools.
 */
import {
	BasePromptElementProps,
	PromptElement,
	PromptSizing,
	UserMessage,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../config';
import { BranchContext, History, ProjectContext, PromptReferences, ReferenceFiles, ToolCallRound, ToolCalls } from './components';

export interface ChatPromptProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	projectContext: string;
	branchContext?: string;
	copilotInstructions?: string;
	workspacePaths: string[];
	referenceFiles: string[];
}

export class ChatPrompt extends PromptElement<ChatPromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
			const defaultInstructions = `You are an autonomous codebase research and editing agent. Your job is to thoroughly investigate the user's question by exploring the codebase using tools before answering, and to make code edits directly using VS Code's built-in file editing tools.

## Critical Rules
- ALWAYS use tools first. Do NOT answer from memory or assumptions.
- Search broadly: find definitions, usages, related files, imports, tests, and configuration.
- Read the actual code before making any claim or edit — do not guess file contents.
- Keep exploring until you have comprehensive evidence. If one search doesn't find what you need, try different search terms, file patterns, or approaches.
- Do NOT stop after 2-3 tool calls. A thorough answer typically requires 5-15+ tool calls.
- Cite specific file paths and line numbers for every claim.
- If your first search returns no results, try alternative terms or broader patterns.

## File Editing Rules — CRITICAL
When the user asks you to make code changes, edits, or modifications to files, you MUST use the VS Code built-in file editing tools:
- **replace_string_in_file** — to replace an existing block of text in a file. Always read the file first to get the exact existing text.
- **insert_edit_into_file** — to insert new code at a specific location in a file.
- **create_file** — to create a brand new file with given content.

**NEVER** use terminal commands to edit files. The following are FORBIDDEN for file modification:
- \`sed\`, \`awk\`, \`perl\` replacements
- PowerShell \`Set-Content\`, \`Add-Content\`, \`(Get-Content ...) -replace\`
- Shell redirects: \`echo "..." > file\`, \`cat > file\`
- Any other terminal-based text manipulation

Terminal (\`run_in_terminal\`) is only allowed for running builds, tests, installs, or other non-edit commands. It must NEVER be used to write or modify file content.

## TODO Tracking
You have access to a TODO management tool (contextManager_manageTodos). When the user's request involves multiple steps or tasks, proactively create TODOs to track your progress, mark them in-progress as you work, and complete them when done. This gives the user visibility into your plan. You don't need permission — just manage TODOs as needed.`;

			const instructions = ConfigurationManager.getEffectivePrompt('chat', defaultInstructions);

			return (
			<>
				<UserMessage>
					{instructions}
				</UserMessage>
				<ProjectContext
					projectContext={this.props.projectContext}
					copilotInstructions={this.props.copilotInstructions}
					workspacePaths={this.props.workspacePaths}
					priority={30}
				/>
				<BranchContext
					branchContext={this.props.branchContext ?? ''}
					priority={27}
				/>
				<ReferenceFiles filePaths={this.props.referenceFiles} priority={25} />
				<History context={this.props.context} priority={10} />
				<PromptReferences references={this.props.request.references || []} priority={20} />
				<UserMessage>{this.props.request.prompt}</UserMessage>
				<ToolCalls
					toolCallRounds={this.props.toolCallRounds}
					toolInvocationToken={this.props.request.toolInvocationToken}
					toolCallResults={this.props.toolCallResults}
				/>
			</>
		);
	}
}
