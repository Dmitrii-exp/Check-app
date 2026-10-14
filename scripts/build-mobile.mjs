import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist-mobile');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const item of ['assets', 'css', 'js', 'public', 'docs']) {
  fs.cpSync(path.join(root, item), path.join(output, item), { recursive: true });
}

// The Android APK must always package the application, never the public landing page.
fs.copyFileSync(path.join(root, 'app', 'index.html'), path.join(output, 'index.html'));

// Bundle Supabase locally: Android WebView must not depend on a third-party CDN for login.
const supabaseUmd = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
if (!fs.existsSync(supabaseUmd)) throw new Error('Missing local Supabase UMD bundle: ' + supabaseUmd);
fs.copyFileSync(supabaseUmd, path.join(output, 'js', 'supabase.js'));
let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
html = html.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.114.0/dist/umd/supabase.js', 'js/supabase.js');
html = html.replace(/\s*<base href="\/"\s*\/>/, '');
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
