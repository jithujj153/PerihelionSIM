import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild-wasm');
const [entry = 'src/main.ts', out = 'dist/perihelion.js'] = process.argv.slice(2);
const t = Date.now();
await esbuild.build({
  entryPoints: [entry], bundle: true, target: 'es2022', outfile: out,
  ...(entry.startsWith('test/') ? { platform: 'node', format: 'cjs', minify: false } : { format: 'iife', minify: true }),
  legalComments: 'none', logLevel: 'warning', charset: 'utf8',
  alias: { 'three/addons': './node_modules/three/examples/jsm' },
});
console.log('built', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', Date.now() - t + ' ms');
process.exit(0);
