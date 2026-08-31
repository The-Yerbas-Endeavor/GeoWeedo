const FAVICON_TARGET = '/assets/geoweedo/favicon.ico';

function redirectToFavicon(request: Request) {
  return Response.redirect(new URL(FAVICON_TARGET, request.url), 307);
}

export function GET(request: Request) {
  return redirectToFavicon(request);
}

export function HEAD(request: Request) {
  return redirectToFavicon(request);
}
