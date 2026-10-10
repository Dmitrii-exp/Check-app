import fs from 'node:fs';
const path='android/app/build.gradle';
let gradle=fs.readFileSync(path,'utf8');
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const parts=version.split('.').map(Number);
if(parts.length!==3||parts.some(n=>!Number.isInteger(n)||n<0||n>99))throw Error('Use semver MAJOR.MINOR.PATCH with parts <= 99');
const code=parts[0]*10000+parts[1]*100+parts[2];
gradle=gradle.replace(/versionCode\s+\d+/, 'versionCode '+code).replace(/versionName\s+["'][^"']+["']/, 'versionName "'+version+'"');
const signing=`    signingConfigs {
        checkAppRelease {
            storeFile file(project.property('CHECKAPP_STORE_FILE'))
            storePassword project.property('CHECKAPP_STORE_PASSWORD')
            keyAlias project.property('CHECKAPP_KEY_ALIAS')
            keyPassword project.property('CHECKAPP_KEY_PASSWORD')
        }
    }
`;
if(!gradle.includes('signingConfigs {'))gradle=gradle.replace(/android\s*\{/,match=>match+'\n'+signing);
gradle=gradle.replace(/release\s*\{/,match=>match+'\n            signingConfig signingConfigs.checkAppRelease');
fs.writeFileSync(path,gradle);
console.log('Configured signed Android release version '+version+' ('+code+')');
