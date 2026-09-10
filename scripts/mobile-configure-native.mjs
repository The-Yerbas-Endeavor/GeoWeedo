#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];
const root = process.cwd();

function replaceOrFail(file, matcher, replacement, label) {
  const original = fs.readFileSync(file, 'utf8');
  const updated = original.replace(matcher, replacement);
  if (updated === original) {
    if (original.includes(replacement)) return;
    throw new Error(`Could not configure ${label} in ${file}`);
  }
  fs.writeFileSync(file, updated);
}

function configureAndroid() {
  const variables = path.join(root, 'android', 'variables.gradle');
  const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const mascotSource = path.join(root, 'public', 'assets', 'geoweedo', 'geoweedo-icon-master.png');
  const drawableDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi');
  const mascotTarget = path.join(drawableDir, 'geoweedo_mascot.png');

  replaceOrFail(
    variables,
    /minSdkVersion\s*=\s*\d+/,
    'minSdkVersion = 26',
    'Android minSdkVersion',
  );

  let xml = fs.readFileSync(manifest, 'utf8');
  const permissions = [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.CAMERA',
  ];

  const missing = permissions.filter((permission) => !xml.includes(`android:name="${permission}"`));
  if (missing.length) {
    const block = missing
      .map((permission) => `    <uses-permission android:name="${permission}" />`)
      .join('\n');
    xml = xml.replace(/(<manifest\b[^>]*>)/, `$1\n${block}`);
  }

  if (!fs.existsSync(mascotSource)) {
    throw new Error(`GeoWeedo mascot icon not found: ${mascotSource}`);
  }
  fs.mkdirSync(drawableDir, { recursive: true });
  fs.copyFileSync(mascotSource, mascotTarget);

  xml = xml
    .replace(/android:icon="@[^"]+"/, 'android:icon="@drawable/geoweedo_mascot"')
    .replace(/android:roundIcon="@[^"]+"/, 'android:roundIcon="@drawable/geoweedo_mascot"');

  fs.writeFileSync(manifest, xml);

  console.log('Configured Android: minSdk 26 + location/camera permissions + GeoWeedo mascot launcher icon');
}

function plistEntry(key, value) {
  return `\t<key>${key}</key>\n\t<string>${value}</string>`;
}

function configureIos() {
  const plist = path.join(root, 'ios', 'App', 'App', 'Info.plist');
  let xml = fs.readFileSync(plist, 'utf8');
  const entries = [
    [
      'NSLocationWhenInUseUsageDescription',
      'GeoWeedo uses your location to show nearby dispensaries and improve location-based game features.',
    ],
    [
      'NSLocationAlwaysAndWhenInUseUsageDescription',
      'GeoWeedo uses location while you are using the app for nearby dispensary and game features.',
    ],
    [
      'NSCameraUsageDescription',
      'GeoWeedo uses the camera to scan product barcodes and QR codes for Weedo Facts.',
    ],
  ];

  const missing = entries.filter(([key]) => !xml.includes(`<key>${key}</key>`));
  if (missing.length) {
    const block = missing.map(([key, value]) => plistEntry(key, value)).join('\n');
    xml = xml.replace(/\n<\/dict>\s*<\/plist>/, `\n${block}\n</dict>\n</plist>`);
    fs.writeFileSync(plist, xml);
  }

  console.log('Configured iOS: location + camera privacy descriptions');
}

if (platform === 'android') {
  configureAndroid();
} else if (platform === 'ios') {
  configureIos();
} else {
  throw new Error('Usage: node scripts/mobile-configure-native.mjs [android|ios]');
}
