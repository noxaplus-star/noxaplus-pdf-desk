import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let html = await readFile(`${root}dist/index.html`, 'utf8');
const sources = [
  ['NoxaPlus PDF Desk', 'LICENSE'], ['React', 'node_modules/react/LICENSE'],
  ['React DOM', 'node_modules/react-dom/LICENSE'], ['Scheduler', 'node_modules/scheduler/LICENSE'],
  ['Vazirmatn', 'node_modules/@fontsource/vazirmatn/LICENSE'],
  ['pdf-lib', 'node_modules/pdf-lib/LICENSE.md'], ['fontkit', 'public/fontkit-license.txt'],
  ['PDF.js', 'node_modules/pdfjs-dist/LICENSE'], ['fflate', 'node_modules/fflate/LICENSE'],
  ['Standard fonts for pdf-lib', 'node_modules/@pdf-lib/standard-fonts/LICENSE.md'],
  ['UPNG', 'node_modules/@pdf-lib/upng/LICENSE'], ['pako', 'node_modules/pako/LICENSE'],
  ['tslib', 'node_modules/tslib/CopyrightNotice.txt'], ['tslib license', 'node_modules/tslib/LICENSE.txt'],
];
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  for (const name of (await readdir(`${root}node_modules/pdfjs-dist/${directory}`)).filter(name => name.startsWith('LICENSE'))) sources.push([`PDF.js ${directory}: ${name}`, `node_modules/pdfjs-dist/${directory}/${name}`]);
}
const entries = await Promise.all(sources.map(async ([name, path]) => `${name}\n${await readFile(`${root}${path}`, 'utf8')}`));
const fontkitSource = await readFile(`${root}node_modules/@pdf-lib/fontkit/dist/fontkit.es.js`, 'utf8');
const bundledNotices = [...new Set((fontkitSource.match(/\/\*[\s\S]*?\*\//g) ?? []).filter(comment => /copyright|permission is hereby|licensed under/i.test(comment)))];
entries.push(`fontkit bundled dependency notices\n${bundledNotices.join('\n\n')}`);
entries.push('PDF.js worker adaptation: the decoder fallback import operand is redirected to embedded Blob modules in src/preview.ts. No PDF input is modified for preview.');
const notices = entries.join('\n\n');
const end = html.lastIndexOf('</body>');
if (end < 0 || /<script[^>]+src="\.\/assets\//.test(html) || /<link[^>]+href="\.\/assets\//.test(html)) throw new Error('Standalone bundle was not fully inlined.');
html = `${html.slice(0, end)}<script type="text/plain" id="third-party-licenses">${notices.replace(/<\/script/gi, '<\\/script')}</script>${html.slice(end)}`;
await writeFile(`${root}dist/index.html`, html);
await writeFile(`${root}dist/THIRD-PARTY-LICENSES.txt`, notices);
const icon = `data:image/svg+xml;base64,${(await readFile(`${root}public/icons/icon.svg`)).toString('base64')}`;
const appleIcon = `data:image/png;base64,${(await readFile(`${root}public/icons/apple-touch-icon.png`)).toString('base64')}`;
const standalone = html.replace(/\s*<link rel="manifest"[^>]*>/, '').replace('href="./icons/icon.svg"', `href="${icon}"`).replace('href="./icons/apple-touch-icon.png"', `href="${appleIcon}"`);
await writeFile(`${root}index.html`, standalone);
console.log(`Standalone index.html written (${(Buffer.byteLength(standalone) / 1024 / 1024).toFixed(2)} MiB).`);
