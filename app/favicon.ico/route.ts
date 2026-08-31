const FAVICON_TARGET = '/assets/geoweedo/favicon.ico';

function redirectToFavicon() {
  return new Response(null, {
    status: 307,
    headers: {
      Location: FAVICON_TARGET,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export function GET() {
  return redirectToFavicon();
}

export function HEAD() {
  return redirectToFavicon();
}
