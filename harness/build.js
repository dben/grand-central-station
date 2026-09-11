#!/usr/bin/env node
// Bundles the ES-module source into one classic script and writes a single
// self-contained HTML file (CSS and sprites inlined) that works from file://.
//   node harness/build.js            -> dist/grand-central-station.html
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/ui/main.js');

const modules = new Map(); // abs path -> { code, deps: [abs], names: [] }
const importRe = /^import\s+(?:(\*\s+as\s+\w+)|(\{[^}]*\})|(\w+))\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const exportRe = /^export\s+(?:const|let|var|function|class|async function)\s+(\w+)/gm;

function load(file) {
  if (modules.has(file)) return;
  const code = readFileSync(file, 'utf8');
  const deps = [];
  for (const m of code.matchAll(importRe)) {
    if (m[4].startsWith('node:')) continue;
    deps.push(resolve(dirname(file), m[4]));
  }
  const names = [...code.matchAll(exportRe)].map(m => m[1]);
  modules.set(file, { code, deps, names });
  for (const d of deps) load(d);
}
load(entry);

// topological order (dependencies first)
const order = [], seen = new Set();
function visit(f) { if (seen.has(f)) return; seen.add(f); for (const d of modules.get(f).deps) visit(d); order.push(f); }
visit(entry);

const idOf = f => '__m_' + relative(root, f).replace(/[^a-zA-Z0-9]/g, '_');
let out = '"use strict";\n';
for (const f of order) {
  const { code, names } = modules.get(f);
  let body = code.replace(importRe, (all, star, braces, def, spec) => {
    if (spec.startsWith('node:')) return '';
    const target = idOf(resolve(dirname(f), spec));
    if (star) return `const ${star.replace(/\*\s+as\s+/, '')} = ${target};`;
    if (braces) return `const ${braces.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')} = ${target};`;
    return `const ${def} = ${target}.default;`;
  });
  body = body.replace(/^export\s+(const|let|var|function|class|async function)\s/gm, '$1 ');
  out += `// ---- ${relative(root, f)}\nconst ${idOf(f)} = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();\n`;
}

// inline sprites as data URIs; drop entries whose file is missing
const missing = [];
out = out.replace(/'assets\/tiles\/([a-z_]+)\.png'/g, (all, key) => {
  const p = resolve(root, `assets/tiles/${key}.png`);
  if (!existsSync(p)) { missing.push(key + '.png'); return 'null'; }
  return `'data:image/png;base64,${readFileSync(p).toString('base64')}'`;
});
out = out.replace("if (cache.has(key)) continue;", "if (cache.has(key) || !url) continue;");
// the soundtrack too: a few MB of base64, but the build stays a single file
out = out.replace(/'assets\/music\/([A-Za-z0-9_]+\.mp3)'/g, (all, file) => {
  const p = resolve(root, `assets/music/${file}`);
  if (!existsSync(p)) { missing.push(file); return 'null'; }
  return `'data:audio/mpeg;base64,${readFileSync(p).toString('base64')}'`;
});

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="src/ui/style.css">', () => `<style>\n${readFileSync(resolve(root, 'src/ui/style.css'), 'utf8')}\n</style>`);
html = html.replace('<script type="module" src="src/ui/main.js"></script>', () => `<script>\n${out}\n</script>`); // function replacer: '$' in source must not be treated as a pattern
html = html.replace(/<script>\nif \(location\.protocol === 'file:'\)[\s\S]*?<\/script>\n/, ''); // no file:// warning in the bundle
mkdirSync(resolve(root, 'dist'), { recursive: true });
const dest = resolve(root, 'dist/grand-central-station.html');
writeFileSync(dest, html);
console.log(`wrote ${relative(root, dest)} (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules)`);
if (missing.length) console.log(`assets not found (sprites fall back to flat rendering, music to silence): ${missing.join(', ')}`);
