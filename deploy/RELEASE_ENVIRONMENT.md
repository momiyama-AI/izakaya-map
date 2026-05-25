# Release Environment

## Target

MVP release target is Render Web Service with Docker.

- Service: `izakaya-price-map`
- Runtime: Docker
- Health check: `/api/v1/health`
- Public app: `/`
- Admin app: `/admin.html`
- Database: SQLite on a Render persistent disk
- Database path: `/app/storage/izakaya-map.sqlite`

## Required Environment Variables

Set these in Render when creating the Blueprint:

| Key | Required | Notes |
|---|---:|---|
| `GOOGLE_MAPS_API_KEY` | Yes | Google Maps JavaScript API key. Restrict by HTTP referrer after the Render URL is known. |
| `GOOGLE_MAPS_MAP_ID` | No | Optional Google Maps Map ID. |
| `ADMIN_TOKEN` | Yes | Render Blueprint can generate this. Copy it to a password manager after creation. |
| `DATABASE_PATH` | Yes | Set by `render.yaml` to `/app/storage/izakaya-map.sqlite`. |
| `NODE_ENV` | Yes | `production`. |
| `PORT` | Yes | `8080`. |

Do not commit real API keys or admin tokens.

## Render Setup

1. Push `main` to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Confirm Render detected the root `render.yaml`.
4. Set `GOOGLE_MAPS_API_KEY` when prompted.
5. Keep the persistent disk enabled:
   - name: `izakaya-data`
   - mount path: `/app/storage`
   - size: `1GB`
6. Deploy.
7. Open `/api/v1/health` and confirm `status` is `ok`.
8. Open `/` and verify the map loads.
9. Open `/admin.html`, enter the generated `ADMIN_TOKEN`, and verify the event log loads.

## Release Check

Local:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl http://localhost:8080 -AdminToken dev-admin-token
```

Production:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl https://YOUR-SERVICE.onrender.com -AdminToken YOUR_ADMIN_TOKEN
```

## Operational Notes

- Render services without a persistent disk have an ephemeral filesystem. SQLite data must be written under `/app/storage`.
- Render persistent disks are attached to a single service instance. Keep the service at one instance while using SQLite.
- Persistent disks disable zero-downtime deploys. Expect a short interruption during release.
- For growth beyond MVP, migrate store and price data from SQLite to managed PostgreSQL.
- Keep `ADMIN_TOKEN` rotated if it is shared or exposed.
- Keep Google Maps API key restricted to the production Render domain and localhost for development.
