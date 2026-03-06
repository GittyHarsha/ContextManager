const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
	// Ensure dist directory exists
	fs.mkdirSync('dist', { recursive: true });

	// Copy sql-wasm.wasm to dist/
	const wasmSrc = path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
	const wasmDst = path.join('dist', 'sql-wasm.wasm');
	if (fs.existsSync(wasmSrc)) {
		fs.copyFileSync(wasmSrc, wasmDst);
	}

	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'warning',
		plugins: [esbuildProblemMatcherPlugin],
		// Keep __dirname working correctly for runtime file access
		define: production ? {} : undefined,
	});

	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[esbuild] build started');
		});
		build.onEnd(result => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[esbuild] build finished');
		});
	},
};

main().catch(e => {
	console.error(e);
	process.exit(1);
});
