import process from 'node:process';
import esbuild from 'esbuild';

import common, { iframeConfig } from './esbuild.common';

(async () => {
	const ctx = await esbuild.context(common);
	const iframeCtx = await esbuild.context(iframeConfig);

	if (process.argv.includes('--watch')) {
		await ctx.watch();
		await iframeCtx.watch();
	}
	else {
		await ctx.rebuild();
		await iframeCtx.rebuild();
		process.exit();
	}
})();
