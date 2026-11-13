import esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'],
  format: 'cjs', target: 'es2022', platform: 'browser', outfile: 'main.js',
  sourcemap: false, minify: false, treeShaking: true,
  banner: { js: '/* Speech Expert — MIT license. Built from the published source. */' },
});
