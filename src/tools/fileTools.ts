/**
 * File system tools — write, replace-string, stat, rename, delete, copy, mkdir.
 *
 * WriteFileTool and ReplaceStringInFileTool use getToolStream() from the
 * barrel index to emit stream.textEdit() calls that drive the VS Code diff UI.
 */

import * as vscode from 'vscode';
import { getToolStream } from './index';

// ─── Interfaces ─────────────────────────────────────────────────

interface IWriteFileParams {
	/** Absolute path to the file to create or overwrite. */
	filePath: string;
	/** Full content to write to the file. */
	content: string;
	/** If true, overwrites the file when it already exists. Default: true. */
	overwrite?: boolean;
}

interface IReplaceStringInFileParams {
	/** Absolute path to the file to edit. */
	filePath: string;
	/** The exact literal string to find and replace. Must uniquely identify the location. */
	oldString: string;
	/** The replacement string. */
	newString: string;
}

interface IFileStatParams { filePath: string; }
interface IRenameFileParams { sourcePath: string; targetPath: string; overwrite?: boolean; }
interface IDeleteFileParams { filePath: string; recursive?: boolean; useTrash?: boolean; }
interface ICopyFileParams { sourcePath: string; targetPath: string; overwrite?: boolean; }
interface ICreateDirectoryParams { dirPath: string; }

// ─── Write File Tool ────────────────────────────────────────────

/**
 * Creates or overwrites a file using vscode.workspace.fs.writeFile().
 * This uses the stable VS Code FileSystem API — guaranteed to write contents.
 */
export class WriteFileTool implements vscode.LanguageModelTool<IWriteFileParams> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IWriteFileParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { filePath, content } = options.input;

		if (!filePath || typeof filePath !== 'string') {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Error: filePath is required and must be a string.'),
			]);
		}

		try {
			const uri = vscode.Uri.file(filePath);
			const text = content ?? '';

			// Emit stream.textEdit() BEFORE writing to disk so VS Code diffs
			// against the current buffer state, not the already-written content.
			try {
				const stream = getToolStream() as any;
				if (stream && typeof stream.textEdit === 'function') {
					const edit = vscode.TextEdit.replace(new vscode.Range(0, 0, 999999, 0), text);
					stream.textEdit(uri, [edit]);
					stream.textEdit(uri, true);
				}
			} catch { /* proposed API unavailable — ignore */ }

			// Always write to disk so follow-up tool reads see the new content.
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Successfully wrote ${text.length} chars to: ${filePath}`),
			]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error writing file "${filePath}": ${msg}`),
			]);
		}
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IWriteFileParams>,
		_token: vscode.CancellationToken,
	) {
		const filePath = options.input?.filePath ?? 'file';
		const short = filePath.split(/[\\/]/).pop() ?? filePath;
		return {
			invocationMessage: `Writing file: ${short}`,
		};
	}
}

// ─── Replace String In File Tool ────────────────────────────────

/**
 * Replaces the first occurrence of oldString with newString in a file.
 * Reads the file, does the replacement, then writes it back.
 */
export class ReplaceStringInFileTool implements vscode.LanguageModelTool<IReplaceStringInFileParams> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IReplaceStringInFileParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { filePath, oldString, newString } = options.input;

		if (!filePath || typeof filePath !== 'string') {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Error: filePath is required.'),
			]);
		}
		if (oldString === undefined || oldString === null) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Error: oldString is required.'),
			]);
		}

		try {
			const uri = vscode.Uri.file(filePath);
			const raw = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(raw);

			if (!text.includes(oldString)) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						`Error: oldString not found in ${filePath}. ` +
						`Make sure it matches the file content exactly (including whitespace and indentation).`
					),
				]);
			}

			// Emit stream.textEdit() BEFORE writing to disk so VS Code diffs
			// against the current buffer state, not the already-written content.
			try {
				const stream = getToolStream() as any;
				if (stream && typeof stream.textEdit === 'function') {
					const matchIndex = text.indexOf(oldString);
					const before = text.substring(0, matchIndex);
					const beforeLines = before.split('\n');
					const startLine = beforeLines.length - 1;
					const startChar = beforeLines[beforeLines.length - 1].length;
					const oldLines = oldString.split('\n');
					const endLine = startLine + oldLines.length - 1;
					const endChar = oldLines.length === 1 ? startChar + oldString.length : oldLines[oldLines.length - 1].length;
					const range = new vscode.Range(startLine, startChar, endLine, endChar);
					stream.textEdit(uri, [vscode.TextEdit.replace(range, newString)]);
					stream.textEdit(uri, true);
				}
			} catch { /* proposed API unavailable — ignore */ }

			// Always write to disk immediately so subsequent tool calls can read the file.
			const updated = text.replace(oldString, newString);
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Successfully replaced string in: ${filePath}`),
			]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error editing file "${filePath}": ${msg}`),
			]);
		}
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IReplaceStringInFileParams>,
		_token: vscode.CancellationToken,
	) {
		const filePath = options.input?.filePath ?? 'file';
		const short = filePath.split(/[\\/]/).pop() ?? filePath;
		return {
			invocationMessage: `Editing file: ${short}`,
		};
	}
}

// ─── File System Operation Tools ───────────────────────────────

export class FileStatTool implements vscode.LanguageModelTool<IFileStatParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IFileStatParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(options.input.filePath));
			const typeStr = stat.type === vscode.FileType.Directory ? 'directory'
				: stat.type === vscode.FileType.File ? 'file'
				: stat.type === vscode.FileType.SymbolicLink ? 'symlink' : 'unknown';
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`type: ${typeStr}\nsize: ${stat.size} bytes\nmtime: ${new Date(stat.mtime).toISOString()}`
			)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`Error: ${err instanceof Error ? err.message : String(err)}`
			)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IFileStatParams>) {
		return { invocationMessage: `Stat: ${options.input?.filePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class RenameFileTool implements vscode.LanguageModelTool<IRenameFileParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IRenameFileParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.rename(vscode.Uri.file(options.input.sourcePath), vscode.Uri.file(options.input.targetPath), { overwrite: options.input.overwrite ?? false });
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Renamed: ${options.input.sourcePath} → ${options.input.targetPath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IRenameFileParams>) {
		return { invocationMessage: `Renaming: ${options.input?.sourcePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class DeleteFileTool implements vscode.LanguageModelTool<IDeleteFileParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IDeleteFileParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.delete(vscode.Uri.file(options.input.filePath), { recursive: options.input.recursive ?? false, useTrash: options.input.useTrash ?? true });
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Deleted: ${options.input.filePath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IDeleteFileParams>) {
		return { invocationMessage: `Deleting: ${options.input?.filePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class CopyFileTool implements vscode.LanguageModelTool<ICopyFileParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICopyFileParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.copy(vscode.Uri.file(options.input.sourcePath), vscode.Uri.file(options.input.targetPath), { overwrite: options.input.overwrite ?? false });
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Copied: ${options.input.sourcePath} → ${options.input.targetPath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICopyFileParams>) {
		return { invocationMessage: `Copying: ${options.input?.sourcePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class CreateDirectoryTool implements vscode.LanguageModelTool<ICreateDirectoryParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICreateDirectoryParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(options.input.dirPath));
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Created directory: ${options.input.dirPath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateDirectoryParams>) {
		return { invocationMessage: `Creating directory: ${options.input?.dirPath?.split(/[\\/]/).pop() ?? 'dir'}` };
	}
}
