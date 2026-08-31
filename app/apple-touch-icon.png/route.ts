const APPLE_ICON_TARGET = '/assets/geoweedo/geoweedo-icon-48.png';

function redirectToAppleIcon() {
  return new Response(null, {
    status: 307,
    headers: {
      Location: APPLE_ICON_TARGET,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export function GET() {
  return redirectToAppleIcon();
}

export function HEAD() {
  return redirectToAppleIcon();
}
