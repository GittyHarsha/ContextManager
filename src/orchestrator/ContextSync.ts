import * as vscode from 'vscode';
import type { AgentRegistry } from './AgentRegistry';
import type { MessageBus } from './MessageBus';

export class ContextSync {
	constructor(
		private registry: AgentRegistry,
		private bus: MessageBus,
	) {}

	/**
	 * Generate additional lines for session-context.txt with orchestrator data.
	 * Called by HookWatcher._syncSessionContext() after existing content is built.
	 */
	generateOrchestratorContext(currentSessionId: string, projectId?: string): string[] {
		const cfg = vscode.workspace.getConfiguration('contextManager.orchestrator');
		if (!cfg.get<boolean>('enabled', true)) { return []; }

		const lines: string[] = [];

		// 1. Fleet status — who else is working on this project
		if (cfg.get<boolean>('injectFleetStatus', false)) {
			this.registry.invalidate(); // pick up external changes
			const peers = this.registry.list(projectId ? { project: projectId } : undefined)
				.filter(a => a.sessionId !== currentSessionId);
			if (peers.length > 0) {
				lines.push('');
				lines.push('## Active Agents on This Project');
				for (const peer of peers.slice(0, 10)) {
					const meta = Object.keys(peer.meta).length > 0 ? ` | meta: ${JSON.stringify(peer.meta)}` : '';
					const age = this._relativeTime(peer.lastSeenAt);
					lines.push(`- [${peer.origin}] ${peer.label || 'unnamed'} (${age} ago)${meta}`);
				}
			}
		}

		// 2. Recent bus messages for this session
		if (cfg.get<boolean>('injectBusMessages', true)) {
			const limit = cfg.get<number>('maxInjectedMessages', 5);
			const messages = this.bus.peek(currentSessionId, { project: projectId, limit });
			if (messages.length > 0) {
				lines.push('');
				lines.push('## Messages from Other Agents');
				for (const msg of messages) {
					const age = this._relativeTime(msg.timestamp);
					const payload = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
					const target = msg.to ? ` → ${msg.to}` : '';
					lines.push(`- [${msg.from}${target}] (${age} ago): ${payload}`);
				}
			}
		}

		return lines;
	}

	private _relativeTime(ts: number): string {
		const diff = Math.max(0, Date.now() - ts);
		const sec = Math.floor(diff / 1000);
		if (sec < 60) { return `${sec}s`; }
		const min = Math.floor(sec / 60);
		if (min < 60) { return `${min}m`; }
		const hr = Math.floor(min / 60);
		return `${hr}h`;
	}

	dispose(): void {
		// nothing to clean up
	}
}
