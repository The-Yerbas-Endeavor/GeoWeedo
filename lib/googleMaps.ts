'use client';

let googleMapsPromise: Promise<any> | null = null;

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'));
  }

  const existing = (window as any).google?.maps;
  if (existing) return Promise.resolve((window as any).google);
  if (googleMapsPromise) return googleMapsPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error('Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to .env.local and restart GeoWeedo.'),
    );
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve((window as any).google);
    script.onerror = () => reject(new Error('Google Maps failed to load. Check the API key and allowed domains.'));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
