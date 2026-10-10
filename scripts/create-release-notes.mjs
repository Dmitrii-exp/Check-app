import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync('public/app-updates.json','utf8'));
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
if(data.latestVersion!==version)throw Error('Release notes version does not match package.json');
console.log('# Check App '+version+'\n');
for(const change of data.changes||[])console.log('- '+(change.type==='fix'?'Исправлено: ':'Новое: ')+change.text);
console.log('\nСкачать APK: файл Check-App-v'+version+'.apk. Для обновления поверх установленного приложения необходим тот же ключ подписи.');
