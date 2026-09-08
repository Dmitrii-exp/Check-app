# Check App — Android

## Requirements
- Node.js LTS
- Android Studio
- Android SDK Platform 36
- Android SDK Build-Tools
- JDK compatible with the installed Android Gradle Plugin

## Setup
```powershell
npm install
npx cap add android
npx cap sync android
npx cap open android
```

## Debug APK
```powershell
npx cap sync android
cd android
./gradlew assembleDebug
```

APK:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Google Play
Use Android Studio:
`Build → Generate Signed Bundle / APK → Android App Bundle`

Keep the release keystore and passwords outside GitHub.

## App identity
Name: Check App
Package ID: `ru.checkapp.mobile`

Verify the final package ID before publishing.

## Release checklist
Test authentication/OTP, Supabase sessions, equipment photos and Storage,
navigation, company/employee flows, subscriptions, back button, network loss,
permissions, and release build on a real Android device.

Never put a Supabase `service_role` secret in the client application.
