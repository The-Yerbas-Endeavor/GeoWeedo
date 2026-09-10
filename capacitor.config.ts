const config = {
  appId: 'com.geoweedo.app',
  appName: 'GeoWeedo',
  webDir: 'mobile-shell',
  server: {
    url: 'https://geoweedo.com',
    cleartext: false,
    allowNavigation: ['geoweedo.com', '*.geoweedo.com'],
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
