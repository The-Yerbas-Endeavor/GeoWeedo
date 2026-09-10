# GeoWeedo Mobile

GeoWeedo mobile uses a shared Capacitor shell around the existing `https://geoweedo.com` Next.js application. The website remains the backend and canonical web application while native Android/iOS capabilities are added where they provide real value.

## Application identity

- App name: `GeoWeedo`
- Bundle/package ID: `com.geoweedo.app`
- Production URL: `https://geoweedo.com`
- Android distribution: Google Play
- iOS distribution: Apple App Store

## Why this architecture

GeoWeedo relies on server-side Next.js routes and application APIs, so the mobile project must not force the web project into a static-only export. Capacitor gives GeoWeedo one shared product surface while allowing native camera, barcode/QR scanning, geolocation, push notifications, haptics, share sheets, deep links and other device integrations.

The initial shell loads the production HTTPS application. Before public store release, the app must contain meaningful native/mobile-specific functionality rather than remaining a thin website wrapper.

## Bootstrap

Android can be initialized on Linux/macOS. iOS production builds require macOS and Xcode.

```bash
cd ~/GeoWeedo
git fetch origin
git checkout feature/mobile-android-ios

chmod +x scripts/mobile-bootstrap.sh
./scripts/mobile-bootstrap.sh android
```

On the Mac used for iOS development:

```bash
./scripts/mobile-bootstrap.sh ios
```

The bootstrap pins Capacitor 8.5.0 and installs the native App, Geolocation, Haptics, Network, Share and Barcode Scanner plugins. It also applies the Android/iOS permissions required for location and product scanning.

Open the projects with:

```bash
npx cap open android
npx cap open ios
```

## Implemented shared native layer

The shared browser-safe adapter lives in `lib/native.ts`. It intentionally avoids scattering Capacitor calls throughout individual pages.

Implemented:

- native runtime/platform detection
- Android hardware back-button handling
- Android root-screen exit behavior
- native geolocation permission/request flow with browser fallback
- native share sheet with Web Share / clipboard fallback
- haptic impact, selection and notification feedback helpers
- native network status lookup and live connectivity events
- global offline UI state via `data-native-network`
- Weedo Facts native barcode/QR scanning
- reusable `WeedoFactsNativeScanner` component

Events available to the web UI:

- `geoweedo:native-ready`
- `geoweedo:native-network`
- `geoweedo:native-back`
- `geoweedo:weedo-facts-scanned`

The Weedo Facts scanner uses the rear camera and ML Kit on Android and emits the scanned value/format for the product/batch lookup layer to consume.

## Release roadmap

### Mobile 0.1 — shell and parity

- Native app identity and branding
- Safe-area support
- Native runtime detection
- Android/iOS project generation
- Login/account flows
- Homepage and game selector
- Browse dispensaries and MapLibre maps
- Classic GeoWeedo
- Weedo Hunt
- Daily Weedo
- My Weedo/profile/history
- Native back-navigation validation
- External-link handling

### Mobile 0.2 — device integrations

Completed:

- Native geolocation permission flow
- Native share sheet
- Haptics foundation
- Camera permission plumbing
- Network/offline state UI
- Android hardware back handling

Remaining:

- Deep links / universal links / Android app links
- Push-notification foundation
- External browser handoff policy
- Status/system bar polish

### Mobile 0.3 — Weedo Facts

Completed foundation:

- Native barcode/QR scanner
- Reusable Scan Product control
- Camera permissions on Android/iOS
- Scan-result event for product/batch lookup integration

Remaining product integration:

- Product identification
- Exact batch/lot lookup where supported
- COA/lab report display
- Cannabinoid/terpene presentation
- Compliance-test summary
- Original COA access
- Scan history in My Weedo

### Mobile 0.4 — discovery integration

- Nearby dispensary availability
- Product-to-dispensary linking
- Favorites
- Product comparisons
- Saved dispensaries
- Location-aware discovery

### Mobile 1.0 — production store release

- Store-compliant native value beyond a simple wrapper
- Accessibility pass
- Phone/tablet responsive QA
- Android signing and Play App Bundle (`.aab`)
- iOS signing/archive and App Store Connect upload
- Privacy policy and support URLs
- Data Safety / App Privacy declarations
- Content/age rating responses
- Store screenshots and feature graphics
- Test tracks / TestFlight validation
- Crash and analytics validation

## Android requirements

For new Google Play submissions after August 31, 2026, the Android app must target Android 16 / API level 36 or higher. Set the generated Android project accordingly before Play submission and re-check the requirement immediately before release.

Current native policy:

- `targetSdkVersion`: 36 or newer required by Play at release time
- `compileSdkVersion`: at least the target SDK
- `minSdkVersion`: 26 because the official Capacitor barcode-scanner plugin requires it
- Distribution artifact: signed `.aab`

## iOS requirements

App Store Connect submissions currently need to be built with Xcode 26 or later using the iOS 26 SDK or later. Re-check Apple's submission requirements immediately before release.

The iOS build must be generated, signed and archived on macOS with Xcode.

Configured privacy descriptions:

- Camera — Weedo Facts barcode/QR scanning
- Location When In Use — nearby dispensaries and location-based game features
- Location Always And When In Use — compatibility description required by the current location plugin stack; GeoWeedo does not currently implement background tracking

## Native API examples

```ts
import {
  getCurrentNativePosition,
  getNativeNetworkStatus,
  nativeHaptic,
  nativeShare,
  scanWeedoFactsCode,
} from '@/lib/native';

const position = await getCurrentNativePosition();
await nativeHaptic('success');
await nativeShare({ title: 'GeoWeedo', url: window.location.href });
const network = await getNativeNetworkStatus();
const scan = await scanWeedoFactsCode();
```

The web application remains authoritative for accounts, gameplay state, dispensary data, sponsorships, Weedo Facts data, product/COA records and server-side business rules.

## Deep-link plan

Desired examples:

- `https://geoweedo.com/` → app home
- `https://geoweedo.com/account` → account
- dispensary detail URL → matching dispensary in app
- game URL → matching game mode
- future Weedo Facts product URL → matching product/batch

Android requires Digital Asset Links (`/.well-known/assetlinks.json`). iOS requires an Apple App Site Association file (`/.well-known/apple-app-site-association`). These should be added after the final Play signing certificate and Apple Team ID are known.

## Store-policy posture for cannabis content

GeoWeedo mobile should initially emphasize discovery, gameplay, product information, laboratory/COA transparency and consumer education. Avoid implementing in-app cannabis purchasing or transaction flows as part of the initial store release. Store policies should be re-reviewed immediately before submission because cannabis-related content and commerce can receive heightened scrutiny.

## Release checklist

1. Generate and validate native projects in CI.
2. Keep Android API target aligned with current Play policy.
3. Configure Android signing and Play App Signing.
4. Configure Apple bundle ID, team and signing.
5. Add Android App Links and iOS Universal Links.
6. Integrate `WeedoFactsNativeScanner` into the Weedo Facts product/batch flow.
7. Add push notification foundation if needed for launch.
8. Test account creation/login/logout and session persistence.
9. Test all three GeoWeedo games on small and large phones.
10. Test MapLibre gestures, map pins, dialogs, keyboard and orientation behavior.
11. Test native location, sharing, haptics and offline/network-loss behavior.
12. Validate privacy disclosures against actual permissions and data collection.
13. Create Play Store and App Store assets/screenshots.
14. Use Google Play internal/closed testing and Apple TestFlight before production.
15. Submit only after the app provides enough native/mobile value to stand independently from the browser version.
