# EITEL public catalog

The public catalog is a metadata-only portal intended for publication at:

```text
https://gis.eiteldata.eu/catalog/
```

It checks configured connector endpoints and displays asset metadata, connector status, and links to the EITEL access form or to the source connector. It does not expose payload URLs, proxy files, negotiate contracts, or execute transfers.

## Service

The Docker service is defined in:

```text
caas/public-catalog/
```

Main files:

- `Dockerfile`: builds the FastAPI catalog service.
- `app.py`: polls configured connector metadata endpoints.
- `connectors.example.yaml`: production-style configuration for `gis.eiteldata.eu`.
- `connectors.local.yaml`: local Docker Compose configuration.
- `static/`: public web UI.

## Standalone use

The catalog is intentionally deployed apart from the connector stack. It only queries configured metadata endpoints.

```bash
cd caas/public-catalog
set LOCAL_ASSETS_AUTH_TOKEN=<same-token-used-by-local-assets>
docker compose up -d --build
```

Open:

```text
http://localhost:18080/catalog/
```

## Publishing at `/catalog`

Run the standalone catalog container on the host. The infrastructure team publishes:

```text
https://gis.eiteldata.eu/catalog/
```

to the container port exposed on the host:

```text
http://127.0.0.1:18080/catalog/
```

## Connector configuration

Edit `caas/public-catalog/connectors.example.yaml` to change:

- connector display name,
- organization,
- public connector URL,
- metadata endpoint,
- health endpoint,
- auth token environment variable,
- EITEL access form URL.

The recommended metadata endpoint is:

```text
https://gis.eiteldata.eu/<connector>/local-assets/asset-bundles/public
```

This endpoint returns metadata prepared by the connector-side local-assets service. The public catalog sanitizes the result and only exposes safe fields such as title, description, visibility, keywords, provider, and access links.

This is the same metadata source used by the connector UI catalog when it derives a provider `local-assets` endpoint from a DSP address. For the production connectors, the public catalog polls:

```text
https://gis.eiteldata.eu/conectoruc3m/local-assets/asset-bundles/public
https://gis.eiteldata.eu/conectorFuenlabrada/local-assets/asset-bundles/public
```

If the connector protects `local-assets`, keep the API key as an environment variable on the catalog container and reference it from the connector entry:

```yaml
authTokenEnv: UC3M_LOCAL_ASSETS_AUTH_TOKEN
fallbackAuthTokenEnv: LOCAL_ASSETS_AUTH_TOKEN
```

The production Docker Compose file reads these values from the same `.env.production` file used by the connector deployment:

```bash
docker compose --env-file ../../.env.production up -d --build
```

Use `UC3M_LOCAL_ASSETS_AUTH_TOKEN` and `FUENLABRADA_LOCAL_ASSETS_AUTH_TOKEN` when each connector has a different key. If they are empty, the catalog falls back to `LOCAL_ASSETS_AUTH_TOKEN`. The token is only used server-side when the catalog polls `gis.eiteldata.eu`; it is not returned to the browser.

Each connector entry can also define a public Gaia-X credential link:

```yaml
credentialUrl: https://eiteldata.uc3m.es/.well-known/vp-UC3Mcompliance.json
```
