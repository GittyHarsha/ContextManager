import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DiscoveredAgent {
	name: string;
	description: string;
	source: 'project' | 'user';
	filePath: string;
}

export class AgentDiscovery {
	/**
	 * Scan all known locations for .agent.md files.
	 * Returns discovered agents with name, description, source, and path.
	 */
	async discover(): Promise<DiscoveredAgent[]> {
		const agents: DiscoveredAgent[] = [];

		// 1. Project-level: .github/agents/*.agent.md
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspaceRoot) {
			const projectDir = path.join(workspaceRoot, '.github', 'agents');
			agents.push(...this._scanDir(projectDir, 'project'));
		}

		// 2. User-level: ~/.copilot/agents/*.agent.md
		const userDir = path.join(os.homedir(), '.copilot', 'agents');
		agents.push(...this._scanDir(userDir, 'user'));

		return agents;
	}

	private _scanDir(dir: string, source: 'project' | 'user'): DiscoveredAgent[] {
		const results: DiscoveredAgent[] = [];
		try {
			if (!fs.existsSync(dir)) { return results; }
			const files = fs.readdirSync(dir).filter(f => f.endsWith('.agent.md'));
			for (const file of files) {
				const filePath = path.join(dir, file);
				const name = file.replace(/\.agent\.md$/, '');
				const description = this._extractDescription(filePath);
				results.push({ name, description, source, filePath });
			}
		} catch {
			// directory doesn't exist or not readable
		}
		return results;
	}

	private _extractDescription(filePath: string): string {
		try {
			const content = fs.readFileSync(filePath, 'utf8');
			// Look for description in YAML frontmatter
			const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
			if (fmMatch) {
				const descMatch = fmMatch[1].match(/description:\s*["']?(.+?)["']?\s*$/m);
				if (descMatch) { return descMatch[1].trim(); }
			}
			// Fallback: first non-empty, non-heading line
			const lines = content.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
					return trimmed.slice(0, 120);
				}
			}
		} catch { /* ignore */ }
		return '';
	}
}
