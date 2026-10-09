import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist-mobile');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const item of ['index.html', 'assets', 'css', 'js', 'public', 'docs']) {
  fs.cpSync(path.join(root, item), path.join(output, item), { recursive: true });
}

let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
html = html.replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '');
html = html.replace(/\s*<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?<\/script>/, '');
if (!html.includes('href="css/tailwind.css"')) {
  html = html.replace('  <link rel="stylesheet" href="css/styles.css" />', '  <link rel="stylesheet" href="css/tailwind.css" />\n  <link rel="stylesheet" href="css/styles.css" />');
}
fs.writeFileSync(path.join(output, 'index.html'), html);
console.log('[Check App] Mobile web bundle prepared at dist-mobile/');
