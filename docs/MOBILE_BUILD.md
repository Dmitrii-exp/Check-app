# Check App — Android / iOS

This work is isolated on the feature/mobile-capacitor-build branch.

## Requirements
- Node.js compatible with Capacitor 8
- Android Studio + Android SDK + JDK for Android
- macOS + Xcode + CocoaPods (as applicable) for iOS
- Apple signing configuration for iOS device distribution

## Build web assets
```bash
npm install
npm run build:mobile
```

## Android
```bash
npx cap add android
npm run cap:sync
npx cap open android
```
In Android Studio build a debug APK for testing. For release distribution configure a signing key privately, then build a signed release APK. Never commit signing keys.

## iOS
On a Mac:
```bash
npx cap add ios
npm run cap:sync
npx cap open ios
```
Configure Apple Team, bundle identifier and signing in Xcode. Installing an iOS app outside the App Store requires an Apple-supported distribution method.

## Test before release
- Email signup and confirmation
- Login, logout, password reset and deep links
- Camera and equipment photo uploads
- Supabase access and connection-loss handling
- Legal pages and payment flows
- App icon, splash, safe areas and Android back navigation

The Supabase UMD library currently loads from a CDN. Offline startup is not yet guaranteed; bundle dependencies locally before production release.
