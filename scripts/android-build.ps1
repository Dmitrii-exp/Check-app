npx cap sync android
Set-Location android
./gradlew assembleDebug
Write-Host "APK: android/app/build/outputs/apk/debug/app-debug.apk"
