/**
 * Shared HTML helper functions for dashboard rendering.
 */

import * as katex from 'katex';

export function escapeHtml(text: unknown): string {
	if (text === undefined || text === null) {
		return '';
	}

	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export function formatAge(timestamp: unknown): string {
	if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
		return 'unknown';
	}

	const diff = Date.now() - timestamp;
	if (diff < 60_000) { return 'just now'; }
	if (diff < 3_600_000) { return `${Math.floor(diff / 60_000)}m ago`; }
	if (diff < 86_400_000) { return `${Math.floor(diff / 3_600_000)}h ago`; }
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatDuration(ms: number): string {
	if (ms < 1_000) { return `${ms}ms`; }
	if (ms < 60_000) { return `${Math.round(ms / 1_000)}s`; }
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/** Lightweight markdown-to-HTML renderer for display in webview */
export function renderMarkdown(text: string): string {
	// Normalize literal escape sequences (from LM tool JSON) to real characters
	text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

	// ── SECURITY NOTE: LaTeX placeholder extraction ──
	// LaTeX blocks are extracted BEFORE escapeHtml because KaTeX needs raw text.
	// Placeholders (\x00LATEX_N\x00) contain no HTML-special characters, so they
	// pass through escapeHtml unchanged. The rendered KaTeX HTML (trusted output
	// from the library, using MathML mode) is restored AFTER escaping, ensuring
	// that all surrounding user content is properly escaped while KaTeX output
	// is injected safely. The same placeholder pattern is used for code blocks.
	const latexBlocks: string[] = [];

	// Display math: $$...$$ or \[...\]
	text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr: string) => {
		try {
			const rendered = katex.renderToString(expr.trim(), { output: 'mathml', displayMode: true, throwOnError: false });
			const idx = latexBlocks.length;
			latexBlocks.push(`<div style="text-align: center; margin: 12px 0; font-size: 1.15em; overflow-x: auto;">${rendered}</div>`);
			return `\x00LATEX_${idx}\x00`;
		} catch { return _m; }
	});
	text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, expr: string) => {
		try {
			const rendered = katex.renderToString(expr.trim(), { output: 'mathml', displayMode: true, throwOnError: false });
			const idx = latexBlocks.length;
			latexBlocks.push(`<div style="text-align: center; margin: 12px 0; font-size: 1.15em; overflow-x: auto;">${rendered}</div>`);
			return `\x00LATEX_${idx}\x00`;
		} catch { return _m; }
	});

	// Inline math: $...$ or \(...\)  (single $ must not span newlines)
	text = text.replace(/\$([^\$\n]+?)\$/g, (_m, expr: string) => {
		try {
			const rendered = katex.renderToString(expr.trim(), { output: 'mathml', displayMode: false, throwOnError: false });
			const idx = latexBlocks.length;
			latexBlocks.push(rendered);
			return `\x00LATEX_${idx}\x00`;
		} catch { return _m; }
	});
	text = text.replace(/\\\((.+?)\\\)/g, (_m, expr: string) => {
		try {
			const rendered = katex.renderToString(expr.trim(), { output: 'mathml', displayMode: false, throwOnError: false });
			const idx = latexBlocks.length;
			latexBlocks.push(rendered);
			return `\x00LATEX_${idx}\x00`;
		} catch { return _m; }
	});

	let html = escapeHtml(text);

	// Extract code blocks first, replace with placeholders to prevent
	// subsequent regex passes from injecting block elements inside <pre><code>
	const codeBlocks: string[] = [];
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
		// Mermaid diagrams: render as a styled diagram block
		if (lang === 'mermaid') {
			const mermaidBlock = `<div style="margin: 8px 0;"><div style="background: var(--vscode-editorWidget-background, rgba(0,0,0,0.2)); padding: 4px 12px; font-size: 0.85em; font-family: var(--vscode-editor-font-family, 'Consolas', monospace); color: var(--vscode-descriptionForeground); border-radius: 4px 4px 0 0; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); display: flex; align-items: center; gap: 6px;"><span style="font-size: 1.1em;">📊</span> mermaid diagram</div><pre style="background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15)); padding: 12px; border-radius: 0 0 4px 4px; overflow-x: auto; margin-top: 0; margin-bottom: 0; font-family: var(--vscode-editor-font-family, 'Consolas', monospace); line-height: 1.6; border-left: 3px solid var(--vscode-charts-blue, #3794ff);"><code>${code.trim()}</code></pre></div>`;
			const index = codeBlocks.length;
			codeBlocks.push(mermaidBlock);
			return `\x00CODEBLOCK_${index}\x00`;
		}
		const langLabel = lang ? `<div style="background: var(--vscode-editorWidget-background, rgba(0,0,0,0.2)); padding: 4px 12px; font-size: 0.85em; font-family: var(--vscode-editor-font-family, 'Consolas', monospace); color: var(--vscode-descriptionForeground); border-radius: 4px 4px 0 0; border-bottom: 1px solid var(--vscode-editorWidget-border, #444);">${lang}</div>` : '';
		const borderRadius = lang ? '0 0 4px 4px' : '4px';
		const marginTop = lang ? '0' : '8px';
		const block = `<div style="margin: 8px 0; font-size: 0.95em;">${langLabel}<pre style="background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15)); padding: 12px; border-radius: ${borderRadius}; overflow-x: auto; margin-top: ${marginTop}; margin-bottom: 0; font-family: var(--vscode-editor-font-family, 'Consolas', monospace); line-height: 1.5;"><code class="language-${lang || 'plain'}">${code.trim()}</code></pre></div>`;
		const index = codeBlocks.length;
		codeBlocks.push(block);
		return `\x00CODEBLOCK_${index}\x00`;
	});

	// Tables (| Header | Header |)
	// Process line-by-line for robustness
	const lines = html.split('\n');
	const outputLines: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		// Check if this line looks like a table header row
		if (line.trim().startsWith('|') && line.includes('|') && i + 1 < lines.length) {
			const nextLine = lines[i + 1];
			// Check if next line is a separator (|---|---|)
			if (/^\|[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(nextLine)) {
				// Parse header cells (split by |, drop first/last empty from leading/trailing |)
				const parseCells = (row: string): string[] => {
					const parts = row.split('|');
					// Drop first element if empty (leading |) and last element if empty (trailing |)
					if (parts.length > 0 && parts[0].trim() === '') { parts.shift(); }
					if (parts.length > 0 && parts[parts.length - 1].trim() === '') { parts.pop(); }
					return parts.map(c => c.trim());
				};

				const headers = parseCells(line);
				
				// Parse alignment from separator
				const sepCells = parseCells(nextLine);
				const alignments = sepCells.map(s => {
					if (s.startsWith(':') && s.endsWith(':')) { return 'center'; }
					if (s.endsWith(':')) { return 'right'; }
					return 'left';
				});

				// Collect body rows
				const bodyRows: string[][] = [];
				let j = i + 2;
				while (j < lines.length && lines[j].includes('|') && lines[j].trim().startsWith('|')) {
					bodyRows.push(parseCells(lines[j]));
					j++;
				}

				// Build table HTML
				let tableHtml = '<table style="border-collapse: collapse; margin: 12px 0; width: 100%;">';
				tableHtml += '<thead><tr>';
				headers.forEach((header, idx) => {
					const align = alignments[idx] || 'left';
					tableHtml += `<th style="border: 1px solid var(--vscode-editorWidget-border, #444); padding: 8px 12px; background: var(--vscode-editorWidget-background, rgba(0,0,0,0.1)); font-weight: bold; text-align: ${align};">${header}</th>`;
				});
				tableHtml += '</tr></thead>';
				tableHtml += '<tbody>';
				bodyRows.forEach(row => {
					tableHtml += '<tr>';
					// Pad row to match header count
					for (let c = 0; c < headers.length; c++) {
						const cell = row[c] ?? '';
						const align = alignments[c] || 'left';
						tableHtml += `<td style="border: 1px solid var(--vscode-editorWidget-border, #444); padding: 8px 12px; text-align: ${align};">${cell}</td>`;
					}
					tableHtml += '</tr>';
				});
				tableHtml += '</tbody></table>';
				outputLines.push(tableHtml);
				i = j;
				continue;
			}
		}
		outputLines.push(line);
		i++;
	}
	html = outputLines.join('\n');

	// Inline code (`...`)
	html = html.replace(/`([^`]+)`/g, '<code style="background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15)); padding: 2px 6px; border-radius: 3px; font-size: 0.9em; font-family: var(--vscode-editor-font-family, \'Consolas\', monospace); color: var(--vscode-editor-foreground);">$1</code>');

	// Headers (#### > ### > ## > #)
	html = html.replace(/^#### (.+)$/gm, '<h4 style="margin: 12px 0 4px 0; font-size: 0.95em;">$1</h4>');
	html = html.replace(/^### (.+)$/gm, '<h3 style="margin: 14px 0 6px 0; font-size: 1.05em;">$1</h3>');
	html = html.replace(/^## (.+)$/gm, '<h2 style="margin: 16px 0 8px 0; font-size: 1.15em;">$1</h2>');
	html = html.replace(/^# (.+)$/gm, '<h1 style="margin: 18px 0 10px 0; font-size: 1.3em;">$1</h1>');

	// Bold + italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	// Bold
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	// Italic
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

	// Blockquotes (> text)
	html = html.replace(/^&gt; (.+)$/gm, '<div style="border-left: 4px solid var(--vscode-textBlockQuote-border, #888); padding-left: 16px; margin: 8px 0; opacity: 0.9;">$1</div>');

	// Links ([text](url))
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: var(--vscode-textLink-foreground, #4080ff); text-decoration: none;">$1</a>');

	// Horizontal rules
	html = html.replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid var(--vscode-editorWidget-border, #444); margin: 12px 0;">');

	// Unordered list items (- item)
	html = html.replace(/^(\s*)- (.+)$/gm, (_m, indent, content) => {
		const level = Math.floor(indent.length / 2);
		return `<div style="padding-left: ${12 + level * 16}px; position: relative;"><span style="position: absolute; left: ${level * 16}px;">•</span>${content}</div>`;
	});

	// Numbered list items (1. item)
	html = html.replace(/^(\s*)(\d+)\. (.+)$/gm, (_m, indent, num, content) => {
		const level = Math.floor(indent.length / 2);
		return `<div style="padding-left: ${12 + level * 16}px; position: relative;"><span style="position: absolute; left: ${level * 16}px;">${num}.</span>${content}</div>`;
	});

	// Convert remaining newlines to <br> (but not after block elements)
	html = html.replace(/\n(?!<)/g, '<br>');

	// Restore code blocks from placeholders
	html = html.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_m, index) => codeBlocks[parseInt(index, 10)]);

	// Restore LaTeX blocks from placeholders
	html = html.replace(/\x00LATEX_(\d+)\x00/g, (_m, index) => latexBlocks[parseInt(index, 10)]);

	return html;
}
