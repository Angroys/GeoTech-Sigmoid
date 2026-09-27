# Cadastre API

The web app finds an owner's parcels by their IDNO/IDNP and lets inspectors look parcels up by cadastral
number. Ownership lives in the real-estate register kept by ASP (IP Cadastrul Bunurilor Imobile); searching it
by an owner's fiscal code is not public and needs an agreement with ASP, typically through the MConnect
interoperability platform. Parcel outlines are published by AGCC on the national geoportal.

The Bun server forwards `/api/cadastre/*` to the service at `CADASTRE_API_URL`. Without that variable it answers
`503 { "message": "The cadastre service is not connected." }`, and the app falls back to demo data: the demo
owner (IDNO `1003600000001`) gets three sample parcels built from the Sireț3 blocks, numbered `3631204101`,
`3631204102` and `3631204103` and marked "Demo data".

## Endpoints

| Request | Answer |
|---|---|
| `GET /api/cadastre/parcels?owner={IDNO/IDNP}` | `200 { "parcels": Parcel[] }` (an empty list when the owner has none) |
| `GET /api/cadastre/parcels/{cadastralNumber}` | `200 Parcel`, or `404` when no such parcel exists |

`Parcel`:

```json
{
  "cadastral_number": "3631204101",
  "area_ha": 1.34,
  "land_use": "Perennial plantation, vineyard",
  "location": "Sireți, Strășeni district",
  "geometry": { "type": "Polygon", "coordinates": [[[629500.0, 5220200.0], "…"]] }
}
```

- `cadastral_number` is the 10-digit number.
- `geometry` is the parcel outline in EPSG:32635, like every other survey file.
- The owner lookup returns only what the owner may see about their own parcels. The number lookup, used by
  inspectors, returns the public parcel attributes above and never the owner's identity.

## How parcels and surveys connect

A drone survey records the cadastral numbers it covers (`parcelNumbers` on the survey source). The owner's
vineyards page lists each parcel with its surveys, or "Add survey" when there is none. Every parcel also has
"Order a drone survey", which opens the DRON Assistance contact page, <https://droneagro.md/en/contact/>.
