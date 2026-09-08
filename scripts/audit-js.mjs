import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('js/app.js', 'utf8');

const defined = new Set();
for (const match of js.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(match[1]);
for (const match of js.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) defined.add(match[1]);

const referenced = new Set();
for (const match of html.matchAll(/(?:onclick|onchange|oninput|onkeydown|onkeyup|onsubmit)\s*=\s*["']([^"']+)["']/gi)) {
  const expr = match[1];
  for (const fn of expr.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) referenced.add(fn[1]);
}

const ignored = new Set(['if', 'for', 'while', 'switch', 'catch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']);
const missing = [...referenced].filter(name => !defined.has(name) && !ignored.has(name));

console.log(`Defined JS handlers/functions: ${defined.size}`);
console.log(`Inline HTML handlers referenced: ${referenced.size}`);
if (missing.length) {
  console.error('Missing functions referenced by HTML:', missing.join(', '));
  process.exitCode = 1;
} else {
  console.log('OK: all inline handler function references are defined in js/app.js.');
}

const forbidden = ['service_role', 'SUPABASE_SERVICE_ROLE_KEY', 'secret_key'];
const source = html + '\n' + js;
const leaked = forbidden.filter(token => source.toLowerCase().includes(token.toLowerCase()));
if (leaked.length) {
  console.error('Potential secret material found in client files:', leaked.join(', '));
  process.exitCode = 1;
} else {
  console.log('OK: no known server-side secret tokens found in client files.');
}
