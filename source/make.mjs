// Builds one self-contained HTML file that runs from disk with no internet.
import { execFileSync } from 'child_process';
import fs from 'fs';
execFileSync('node', ['build.mjs', 'src/main.ts', 'dist/perihelion.js'], { stdio: 'inherit' });
const read = (p) => fs.readFileSync(p, 'utf8');
const js = read('dist/perihelion.js').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const html = read('src/index.html').replace('/*CSS*/', () => read('src/ui/style.css')).replace('/*JS*/', () => '/* Includes three.js (MIT licence), https://threejs.org */\n' + js);
fs.writeFileSync('dist/PERIHELION-simulator.html', html);
console.log('wrote dist/PERIHELION-simulator.html', (html.length / 1024).toFixed(0) + ' KB');
