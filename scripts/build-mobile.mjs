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
// Always load the locally compiled Tailwind stylesheet before custom styles.
// Match cache-busted styles.css URLs as well as the plain filename.
if (!/<link\s+rel="stylesheet"\s+href="css\/tailwind\.css(?:\?[^"]*)?"\s*\/>/.test(html)) {
  html = html.replace(
    /(<link\s+rel="stylesheet"\s+href="css\/styles\.css(?:\?[^"]*)?"\s*\/>)/,
    '  <link rel="stylesheet" href="css/tailwind.css" />\n  $1'
  );
}
if (!html.includes('href="css/tailwind.css"')) {
  throw new Error('Production build is missing the locally compiled Tailwind CSS link');
}
if (!fs.existsSync(path.join(output, 'css', 'tailwind.css'))) {
  throw new Error('Production build is missing compiled css/tailwind.css');
}
fs.writeFileSync(path.join(output, 'index.html'), html);
console.log('[Check App] Mobile web bundle prepared at dist-mobile/');
