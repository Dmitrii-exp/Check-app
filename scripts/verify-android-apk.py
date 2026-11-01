"""Check the release contains the current UI before publishing it."""
import json
import sys
import zipfile
from pathlib import Path

version = json.loads(Path('package.json').read_text())['version']
with zipfile.ZipFile(sys.argv[1]) as apk:
    for path in ['js/interface.js', 'js/engine-hours.js', 'js/app.js', 'css/styles.css', 'js/update-center.js']:
        assert apk.read('assets/public/' + path) == Path('dist-mobile', path).read_bytes(), path
    html = apk.read('assets/public/index.html').decode()
    assert html == Path('dist-mobile/index.html').read_text(), 'Packaged HTML differs from build'
    auth = html.split('id="auth-screen"', 1)[1].split('id="app-screen"', 1)[0]
    assert 'data-theme-control' not in auth, 'Theme control must not appear in authorization'
    assert html.count('data-theme-control') == 1, 'Keep one theme control in cabinet'
    assert 'Версия ' + version in html, 'Incorrect displayed version'
    assert json.loads(apk.read('assets/capacitor.config.json'))['appId'] == 'ru.checkapp.mobile'
print('PASS: APK contains the verified UI and version ' + version)
