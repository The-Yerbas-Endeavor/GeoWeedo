# GeoWeedo dispensary map deep links

Public dispensary profiles route their address link back to the GeoWeedo homepage map using `/?location=<location-id>`.

The homepage deep-link helper resolves the location through `/api/dispensaries/<id>`, filters the browse list to the matching dispensary, and activates the existing location-focus behavior so the GeoWeedo map centers on the shop.
