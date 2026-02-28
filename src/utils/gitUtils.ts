/**
 * Git utility functions for branch tracking.
 * Uses raw child_process.execFile to avoid adding dependencies.
 * All functions gracefully return defaults if git is unavailable.
 */

import { execFile } from 'child_process';

/** Result of a git command execution */
interface GitResult {
	stdout: string;
	stderr: string;
}

// ─── Security ───────────────────────────────────────────────────

/**
 * Characters that must never appear in a git ref supplied by the user.
 * While `execFile` already prevents shell injection (args are never
 * passed through a shell), validating refs is defense-in-depth against
 * path traversal, flag injection (`--`), and other git-specific attacks.
 */
const DANGEROUS_REF_CHARS = /[;&|$`\\\n\r'"(){}<>\x00]/;

/**
 * Validate and trim a user-supplied git ref (branch name, tag, etc.).
 * Throws if the ref contains dangerous characters or looks like a flag.
 */
export function sanitizeGitRef(ref: string): string {
	const trimmed = ref.trim();
	if (!trimmed) { throw new Error('Empty git ref'); }
	if (DANGEROUS_REF_CHARS.test(trimmed)) {
		throw new Error(`Invalid git ref: contains disallowed characters`);
	}
	// Reject refs that start with '-' (could be interpreted as flags)
	if (trimmed.startsWith('-')) {
		throw new Error(`Invalid git ref: must not start with '-'`);
	}
	return trimmed;
}

/**
 * Execute a git command in the given working directory.
 * Returns stdout/stderr. Rejects on non-zero exit code.
 */
export function execGit(args: string[], cwd: string, timeoutMs = 10_000): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) {
				reject(err);
			} else {
				resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
			}
		});
	});
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Resolve the base branch to diff against.
 * If `configured` is provided and exists, use it. Otherwise auto-detect main/master.
 * Returns empty string if nothing found.
 */
export async function resolveBaseBranch(cwd: string, configured?: string): Promise<string> {
	if (configured) {
		try {
			const safe = sanitizeGitRef(configured);
			await execGit(['rev-parse', '--verify', safe], cwd);
			return safe;
		} catch { /* configured branch doesn't exist or invalid */ }
	}
	// Auto-detect
	for (const candidate of ['main', 'master']) {
		try {
			await execGit(['rev-parse', '--verify', candidate], cwd);
			return candidate;
		} catch { /* try next */ }
	}
	return '';
}

/**
 * Get the current git branch name.
 * Returns undefined if not in a git repo.
 */
export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
		return stdout || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get the current git user name.
 */
export async function getCurrentUser(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execGit(['config', 'user.name'], cwd);
		return stdout || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get the current git user email.
 */
export async function getCurrentUserEmail(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execGit(['config', 'user.email'], cwd);
		return stdout || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get changed files with status indicators, similar to git source control.
 * Includes: working-tree changes (staged + unstaged) and optionally files
 * touched by the user's recent commits.
 */
/**
 * Get all files changed on this branch (merge-base..HEAD) plus any uncommitted changes.
 * Returns a unified list — every file that differs from the base branch, whether committed or not.
 */
export async function getChangedFiles(cwd: string, _author?: string, _includeRecentCommits: number = 5, configuredBaseBranch?: string): Promise<string[]> {
	try {
		const baseBranch = await resolveBaseBranch(cwd, configuredBaseBranch);

		const allFiles = new Set<string>();

		// 1. Committed changes on this branch vs merge-base
		if (baseBranch) {
			try {
				const { stdout: mergeBase } = await execGit(['merge-base', 'HEAD', baseBranch], cwd);
				if (mergeBase.trim()) {
					const { stdout: diffOut } = await execGit(['diff', '--name-only', mergeBase.trim() + '..HEAD'], cwd);
					for (const f of diffOut.split('\n')) {
						if (f.trim()) { allFiles.add(f.trim()); }
					}
				}
			} catch { /* merge-base fails */ }
		}

		// 2. Uncommitted changes (staged + unstaged) — exclude untracked (??) files
		try {
			const { stdout: statusOut } = await execGit(['status', '--short'], cwd);
			for (const line of statusOut.split('\n')) {
				const l = line.trim();
				if (l.length > 0 && !l.startsWith('??')) {
					allFiles.add(l.slice(2).trim());
				}
			}
		} catch { /* git status fails */ }

		// Return as a simple list of file paths (no status prefixes)
		return [...allFiles];
	} catch {
		return [];
	}
}

/**
 * Get recent commits by a specific author on this branch only.
 * Scoped to main..HEAD (commits unique to this branch), filtered by exact email match.
 * Falls back to recent global commits if merge-base detection fails.
 */
export async function getRecentCommits(
	cwd: string,
	author: string,
	count: number = 15,
	configuredBaseBranch?: string,
): Promise<string[]> {
	try {
		const baseBranch = await resolveBaseBranch(cwd, configuredBaseBranch);
		let range = '';
		if (baseBranch) {
			try {
				const { stdout: mergeBase } = await execGit(['merge-base', 'HEAD', baseBranch], cwd);
				if (mergeBase.trim()) { range = mergeBase.trim() + '..HEAD'; }
			} catch { /* merge-base fails */ }
		}

		// Build args: branch-scoped if possible, otherwise recent global
		const logArgs = range
			? ['log', '--format=%ae\t%h %s', '--no-merges', range]
			: ['log', '--format=%ae\t%h %s', `-n`, String(count * 5), '--no-merges'];

		const { stdout } = await execGit(logArgs, cwd);
		if (!stdout) { return []; }

		const authorLower = author.toLowerCase();
		return stdout
			.split('\n')
			.filter(l => l.trim().length > 0)
			.filter(l => {
				const tab = l.indexOf('\t');
				if (tab < 0) { return false; }
				return l.substring(0, tab).toLowerCase() === authorLower;
			})
			.map(l => l.substring(l.indexOf('\t') + 1))
			.slice(0, count);
	} catch {
		return [];
	}
}

/**
 * Get diff stats (insertions/deletions per file) for uncommitted changes.
 */
export async function getDiffStats(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execGit(['diff', '--stat'], cwd);
		return stdout || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get list of local branch names.
 */
export async function getLocalBranches(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execGit(['branch', '--format=%(refname:short)'], cwd);
		if (!stdout) { return []; }
		return stdout.split('\n').filter(l => l.trim().length > 0);
	} catch {
		return [];
	}
}

/**
 * Check if git is available in the given directory.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
	try {
		await execGit(['rev-parse', '--is-inside-work-tree'], cwd);
		return true;
	} catch {
		return false;
	}
}

/**
 * Capture a full git snapshot: branch, user, changed files, recent commits, diff stats.
 * Returns undefined if git is not available.
 */
export interface GitSnapshot {
	branch: string;
	author: string;
	authorEmail?: string;
	changedFiles: string[];
	recentCommits: string[];
	diffStats?: string;
	capturedAt: number;
}

/**
 * Get a bounded diff between two refs, capped at maxFiles file previews.
 * Returns structured output safe for context injection.
 */
export interface BoundedDiffResult {
	totalFiles: number;
	totalInsertions: number;
	totalDeletions: number;
	files: { name: string; additions: number; deletions: number; preview: string }[];
	remainingFiles: string[];
}

export async function getBoundedDiff(
	cwd: string,
	ref1: string = 'main',
	ref2: string = 'HEAD',
	maxFiles: number = 5,
): Promise<BoundedDiffResult> {
	const safeRef1 = sanitizeGitRef(ref1);
	const safeRef2 = sanitizeGitRef(ref2);
	const result: BoundedDiffResult = { totalFiles: 0, totalInsertions: 0, totalDeletions: 0, files: [], remainingFiles: [] };
	try {
		// Get stat overview
		const { stdout: statOutput } = await execGit(['diff', `${safeRef1}..${safeRef2}`, '--stat'], cwd);
		const statLines = statOutput.split('\n').filter((l: string) => l.trim());
		// Last line is summary like " 5 files changed, 100 insertions(+), 20 deletions(-)"
		const summaryLine = statLines[statLines.length - 1] || '';
		const filesMatch = summaryLine.match(/(\d+) files? changed/);
		const insMatch = summaryLine.match(/(\d+) insertions?/);
		const delMatch = summaryLine.match(/(\d+) deletions?/);
		result.totalFiles = filesMatch ? parseInt(filesMatch[1]) : 0;
		result.totalInsertions = insMatch ? parseInt(insMatch[1]) : 0;
		result.totalDeletions = delMatch ? parseInt(delMatch[1]) : 0;

		// Get file names with numstat
		const { stdout: numstatOutput } = await execGit(['diff', `${safeRef1}..${safeRef2}`, '--numstat'], cwd);
		const fileEntries = numstatOutput.split('\n').filter((l: string) => l.trim()).map((line: string) => {
			const [add, del, name] = line.split('\t');
			return { name: name || '', additions: parseInt(add) || 0, deletions: parseInt(del) || 0 };
		}).sort((a: any, b: any) => (b.additions + b.deletions) - (a.additions + a.deletions));

		// Get preview for top N files
		for (let i = 0; i < Math.min(maxFiles, fileEntries.length); i++) {
			const entry = fileEntries[i];
			try {
				const { stdout: diff } = await execGit(['diff', `${safeRef1}..${safeRef2}`, '--', entry.name], cwd);
				const lines = diff.split('\n').slice(0, 40); // First 40 lines of diff
				result.files.push({ ...entry, preview: lines.join('\n') });
			} catch {
				result.files.push({ ...entry, preview: '(diff unavailable)' });
			}
		}
		result.remainingFiles = fileEntries.slice(maxFiles).map((f: any) => f.name);
	} catch { /* git not available or refs don't exist */ }
	return result;
}

/**
 * Get commit log between two timestamps.
 */
export async function getLogRange(
	cwd: string,
	since: number,
	until: number,
	maxCommits: number = 20,
): Promise<string[]> {
	try {
		const sinceDate = new Date(since).toISOString();
		const untilDate = new Date(until).toISOString();
		const { stdout } = await execGit([
			'log', `--after=${sinceDate}`, `--before=${untilDate}`,
			`-n`, `${maxCommits}`, '--oneline'
		], cwd);
		return stdout.split('\n').filter(l => l.trim());
	} catch {
		return [];
	}
}

export async function captureGitSnapshot(
	cwd: string,
	maxCommits: number = 15,
	configuredBaseBranch?: string,
): Promise<GitSnapshot | undefined> {
	const branch = await getCurrentBranch(cwd);
	if (!branch) { return undefined; }

	const author = await getCurrentUser(cwd);
	if (!author) { return undefined; }

	const authorEmail = await getCurrentUserEmail(cwd);
	// Use email for filtering (git log %ae gives email, not name)
	const filterBy = authorEmail || author;

	const [changedFiles, recentCommits, diffStats] = await Promise.all([
		getChangedFiles(cwd, filterBy, maxCommits, configuredBaseBranch),
		getRecentCommits(cwd, filterBy, maxCommits, configuredBaseBranch),
		getDiffStats(cwd),
	]);

	return {
		branch,
		author,
		authorEmail,
		changedFiles,
		recentCommits,
		diffStats,
		capturedAt: Date.now(),
	};
}
