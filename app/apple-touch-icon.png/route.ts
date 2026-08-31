const APPLE_ICON_TARGET = '/assets/geoweedo/geoweedo-icon-48.png';

function redirectToAppleIcon(request: Request) {
  return Response.redirect(new URL(APPLE_ICON_TARGET, request.url), 307);
}

export function GET(request: Request) {
  return redirectToAppleIcon(request);
}

export function HEAD(request: Request) {
  return redirectToAppleIcon(request);
}
