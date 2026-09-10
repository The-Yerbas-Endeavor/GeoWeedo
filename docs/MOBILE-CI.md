# GeoWeedo Mobile CI

GeoWeedo Android builds are produced by GitHub Actions from `.github/workflows/mobile-android.yml`.

## Automatic builds

The workflow runs for:

- pushes to `feature/mobile-android-ios` that touch mobile/app files
- pull requests into `main` that touch mobile/app files
- manual `workflow_dispatch` runs

The workflow generates the Capacitor Android project in CI, builds with Java 21, and uploads a single artifact bundle named `geoweedo-android-<run number>`.

The artifact contains:

- `geoweedo-debug.apk` — debug-signed installable build for device testing
- `geoweedo-release-unsigned.aab` — unsigned release Android App Bundle for validating the production build path
- `SHA256SUMS.txt` — hashes for both build outputs

Artifacts are retained for 30 days.

## Installing the debug APK

Download the `geoweedo-android-<run number>` artifact from the successful GitHub Actions run, extract it, and install `geoweedo-debug.apk` on an Android test device. Android may require permission to install apps from the browser/file manager used to open the APK.

## Production signing

Do not commit Android signing keys, keystore passwords, Apple signing certificates, or provisioning credentials to this repository.

Before Google Play production release, the workflow will be extended to reconstruct a signing keystore from encrypted GitHub Actions secrets and produce a signed release AAB. The expected secret set will include values equivalent to:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Exact secret names may be adjusted when Play Console signing is configured.

## iOS

iOS CI will use a macOS GitHub Actions runner. It will be added after the Apple Developer team ID, bundle signing identity, App Store Connect setup, and provisioning strategy are available. Until then, Android CI can progress independently.

## Release intent

Debug APKs are development/test artifacts. The Google Play production artifact is the signed AAB. iOS production distribution will use an App Store/TestFlight archive rather than an APK-style file.
