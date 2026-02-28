import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeHtml, formatAge, formatDuration, getNonce, renderMarkdown } from '../htmlHelpers';

// ── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
	it('escapes ampersand', () => {
		expect(escapeHtml('a & b')).toBe('a &amp; b');
	});

	it('escapes less-than', () => {
		expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
	});

	it('escapes greater-than', () => {
		expect(escapeHtml('a > b')).toBe('a &gt; b');
	});

	it('escapes double quotes', () => {
		expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
	});

	it('escapes single quotes', () => {
		expect(escapeHtml("it's")).toBe("it&#039;s");
	});

	it('returns empty string unchanged', () => {
		expect(escapeHtml('')).toBe('');
	});

	it('passes through string with no special characters', () => {
		expect(escapeHtml('hello world 123')).toBe('hello world 123');
	});

	it('escapes all special characters combined', () => {
		expect(escapeHtml(`<a href="x" class='y'>&`))
			.toBe('&lt;a href=&quot;x&quot; class=&#039;y&#039;&gt;&amp;');
	});
});

// ── formatAge ───────────────────────────────────────────────────────────────

describe('formatAge', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('returns "just now" for < 60s', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 30_000)).toBe('just now');
	});

	it('returns minutes ago', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 150_000)).toBe('2m ago');
	});

	it('returns hours ago', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 7_200_000)).toBe('2h ago');
	});

	it('returns days ago', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 172_800_000)).toBe('2d ago');
	});

	it('boundary: exactly 60000ms returns "1m ago"', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 60_000)).toBe('1m ago');
	});

	it('boundary: exactly 3600000ms returns "1h ago"', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 3_600_000)).toBe('1h ago');
	});

	it('boundary: exactly 86400000ms returns "1d ago"', () => {
		const now = Date.now();
		vi.setSystemTime(now);
		expect(formatAge(now - 86_400_000)).toBe('1d ago');
	});

	afterEach(() => {
		vi.useRealTimers();
	});
});

// ── formatDuration ──────────────────────────────────────────────────────────

describe('formatDuration', () => {
	it('formats milliseconds (< 1s)', () => {
		expect(formatDuration(500)).toBe('500ms');
	});

	it('formats seconds (< 60s)', () => {
		expect(formatDuration(3_500)).toBe('4s');
	});

	it('formats minutes and seconds', () => {
		expect(formatDuration(125_000)).toBe('2m 5s');
	});

	it('formats exactly 0ms', () => {
		expect(formatDuration(0)).toBe('0ms');
	});

	it('formats exactly 1000ms as seconds', () => {
		expect(formatDuration(1_000)).toBe('1s');
	});

	it('formats exactly 60000ms as minutes', () => {
		expect(formatDuration(60_000)).toBe('1m 0s');
	});
});

// ── getNonce ────────────────────────────────────────────────────────────────

describe('getNonce', () => {
	it('returns a 32-character string', () => {
		expect(getNonce()).toHaveLength(32);
	});

	it('only contains alphanumeric characters', () => {
		const nonce = getNonce();
		expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
	});

	it('returns different values on successive calls', () => {
		const a = getNonce();
		const b = getNonce();
		expect(a).not.toBe(b);
	});
});

// ── renderMarkdown ──────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
	it('renders bold text', () => {
		const result = renderMarkdown('**bold**');
		expect(result).toContain('<strong>bold</strong>');
	});

	it('renders inline code', () => {
		const result = renderMarkdown('use `foo()` here');
		expect(result).toContain('<code');
		expect(result).toContain('foo()');
	});

	it('renders code blocks', () => {
		const result = renderMarkdown('```js\nconst x = 1;\n```');
		expect(result).toContain('<pre');
		expect(result).toContain('<code');
		expect(result).toContain('const x = 1;');
	});

	it('renders h1 headers', () => {
		const result = renderMarkdown('# Title');
		expect(result).toContain('<h1');
		expect(result).toContain('Title');
	});

	it('renders h2 headers', () => {
		const result = renderMarkdown('## Subtitle');
		expect(result).toContain('<h2');
		expect(result).toContain('Subtitle');
	});

	it('renders links', () => {
		const result = renderMarkdown('[click](https://example.com)');
		expect(result).toContain('<a href="https://example.com"');
		expect(result).toContain('click');
	});

	it('returns empty string for empty input', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('renders italic text', () => {
		const result = renderMarkdown('*italic*');
		expect(result).toContain('<em>italic</em>');
	});

	it('renders bold+italic text', () => {
		const result = renderMarkdown('***both***');
		expect(result).toContain('<strong><em>both</em></strong>');
	});

	it('escapes HTML in user content', () => {
		const result = renderMarkdown('<script>alert("xss")</script>');
		expect(result).not.toContain('<script>');
		expect(result).toContain('&lt;script&gt;');
	});

	it('renders blockquotes', () => {
		const result = renderMarkdown('> a quote');
		expect(result).toContain('a quote');
		expect(result).toContain('border-left');
	});

	it('renders horizontal rules', () => {
		const result = renderMarkdown('---');
		expect(result).toContain('<hr');
	});

	it('renders unordered list items', () => {
		const result = renderMarkdown('- item one');
		expect(result).toContain('item one');
		expect(result).toContain('•');
	});
});
