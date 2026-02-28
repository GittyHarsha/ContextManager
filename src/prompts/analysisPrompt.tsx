/**
 * /explain, /usage, /relationships prompts — symbol analysis with tools.
 */
import {
	BasePromptElementProps,
	PromptElement,
	PromptSizing,
	UserMessage,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../config';
import { History, ProjectContext, PromptReferences, ReferenceFiles, ToolCallRound, ToolCalls } from './components';

export type AnalysisCommand = 'explain' | 'usage' | 'relationships';

export interface AnalysisPromptProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	command: AnalysisCommand;
	symbol: string;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
	projectContext: string;
	copilotInstructions?: string;
	workspacePaths: string[];
	referenceFiles: string[];
}

const DEFAULT_INSTRUCTIONS: Record<AnalysisCommand, string> = {
	explain: `You are a code documentation assistant. Given a symbol name, thoroughly investigate it using the available tools.

Use tools as many times as needed — search for the definition, read the code, search for usages, read related files, follow imports, and explore anything relevant. Do not stop exploring prematurely; keep calling tools until you have a comprehensive understanding.

Then explain:
- **Purpose** (cite the file and line numbers)
- **Key behavior** (what it does, with code quotes)
- For classes: **Key methods** (only methods you found in the code)
- **How it fits** into the broader architecture

Only state verified facts. Cite file paths and line numbers for every claim.`,

	usage: `You are a code analysis assistant. Given a usage site, thoroughly investigate it using the available tools.

Use tools as many times as needed — search for the calling code, read the definition being called, find other usages, explore related patterns, and follow the data flow. Do not stop exploring prematurely; keep calling tools until you fully understand the usage context.

Then explain:
- **Why** is this symbol used here? (cite specific code)
- **What role** does it play in this context? (quote relevant code)
- **Notable patterns** (only with cited evidence)
- **Data flow** — how data arrives and leaves through this usage

Only state verified facts. Cite file paths and line numbers for every claim.`,

	relationships: `You are a code architecture assistant. Given a class name, thoroughly investigate it using the available tools.

Use tools as many times as needed — search for the class definition, find parent classes, explore interfaces it implements, search for collaborators, read how other classes reference it, and trace the full inheritance chain. Do not stop exploring prematurely; keep calling tools until you have a complete picture of the architecture.

Then explain:
- **Role** in the architecture (cite file and inheritance chain)
- **Parent classes & interfaces** (only those you found)
- **Key collaborators** (only verified interactions)
- **Design pattern** (only with cited evidence)

Only state verified facts. Cite file paths and line numbers for every claim.`,
};

export class AnalysisPrompt extends PromptElement<AnalysisPromptProps, void> {
	render(_state: void, _sizing: PromptSizing) {
		const instruction = ConfigurationManager.getEffectivePrompt(
			this.props.command,
			DEFAULT_INSTRUCTIONS[this.props.command]
		);

		return (
			<>
				<UserMessage>
					{instruction}<br /><br />
					Include full file paths in output so explanations are self-contained.
				</UserMessage>
				<ProjectContext
					projectContext={this.props.projectContext}
					copilotInstructions={this.props.copilotInstructions}
					workspacePaths={this.props.workspacePaths}
					priority={30}
				/>
				<ReferenceFiles filePaths={this.props.referenceFiles} priority={25} />
				<History context={this.props.context} priority={10} />
				<PromptReferences references={this.props.request.references || []} priority={20} />
				<UserMessage>
					Symbol to analyze: "{this.props.symbol}"<br /><br />
					Do NOT answer yet. First, search the codebase for this symbol, read the source code, trace its usages, explore related files, and gather comprehensive evidence. Only write your analysis after thorough investigation.
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
