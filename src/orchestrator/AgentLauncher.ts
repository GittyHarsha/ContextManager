import * as vscode from 'vscode';

export interface LaunchOptions {
	agent?: string;
	prompt?: string;
	interactive?: boolean;
	autopilot?: boolean;
	allowAll?: boolean;
	cwd?: string;
	sessionId?: string;
}

export class AgentLauncher {
	/**
	 * Launch a Copilot CLI session in a new VS Code terminal.
	 * Uses `copilot --agent=X` and related flags.
	 */
	launch(opts: LaunchOptions): vscode.Terminal {
		const args: string[] = [];

		if (opts.sessionId) {
			args.push(`--resume=${opts.sessionId}`);
		} else if (opts.agent) {
			args.push(`--agent=${opts.agent}`);
		}

		if (opts.autopilot) { args.push('--autopilot'); }
		if (opts.allowAll) { args.push('--allow-all'); }

		if (opts.prompt) {
			const escaped = opts.prompt.replace(/"/g, '\\"');
			const flag = opts.interactive !== false ? '-i' : '-p';
			args.push(`${flag} "${escaped}"`);
		}

		const cmd = `copilot ${args.join(' ')}`.trim();
		const name = opts.sessionId
			? `📋 Resume: ${opts.sessionId.slice(0, 8)}`
			: opts.agent
				? `🤖 ${opts.agent}`
				: '🤖 Copilot';

		const terminal = vscode.window.createTerminal({
			name,
			cwd: opts.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		});
		terminal.sendText(cmd);
		terminal.show();
		return terminal;
	}

	/** Resume an existing Copilot CLI session in a new terminal. */
	resume(sessionId: string, cwd?: string): vscode.Terminal {
		return this.launch({ sessionId, cwd });
	}
}
