import fs from 'node:fs';

const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');

const before = html;
html = html.replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '');
html = html.replace(/\s*<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?<\/script>/, '');
if (!html.includes('href="css/tailwind.css"')) {
  html = html.replace('  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />', '  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />\n  <link rel="stylesheet" href="css/tailwind.css" />');
}

if (html === before) {
  console.log('[Check App] Production preparation: no Tailwind CDN changes were necessary.');
} else {
  fs.writeFileSync(path, html);
  console.log('[Check App] Production preparation: Tailwind CDN removed and compiled CSS linked.');
}
