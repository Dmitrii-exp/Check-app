import fs from 'node:fs';
const target = process.argv[2];
if (target === 'android') {
  const file = 'android/app/src/main/AndroidManifest.xml';
  let xml = fs.readFileSync(file, 'utf8');
  const filter = `<intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="ru.checkapp.mobile" android:host="recovery" />
            </intent-filter>`;
  if (!xml.includes('android:scheme="ru.checkapp.mobile"')) {
    xml = xml.replace('</activity>', filter + '\n        </activity>');
    fs.writeFileSync(file, xml);
  }
} else if (target === 'ios') {
  const file = 'ios/App/App/Info.plist';
  let xml = fs.readFileSync(file, 'utf8');
  if (!xml.includes('<string>ru.checkapp.mobile</string>')) {
    xml = xml.replace('</dict>', `<key>CFBundleURLTypes</key>
    <array><dict>
      <key>CFBundleURLSchemes</key>
      <array><string>ru.checkapp.mobile</string></array>
    </dict></array>
  </dict>`);
    fs.writeFileSync(file, xml);
  }
} else {
  throw new Error('Usage: node scripts/configure-mobile-links.mjs android|ios');
}
console.log('Configured recovery URL scheme for', target);
