# Reproducibility Guide

This guide describes the recommended local reproduction path for TOPIC Connector.

## 1. Clone

```bash
git clone https://github.com/krgroup/TOPIC-Connector.git
cd TOPIC-Connector
git checkout v1.0.2
```

If the tag is not available in a local clone, use the `main` branch corresponding to the release.

## 2. Configure

```bash
cp .env.example .env
```

For PowerShell:

```powershell
Copy-Item .env.example .env
```

The local reproduction profile disables ArcGIS login by default and uses placeholder credentials suitable for a local test stack.

## 3. Start

```bash
docker compose --env-file .env -f docker-compose.yaml up -d --build
```

## 4. Validate

Run:

```bash
./scripts/validate_stack.sh
./scripts/validate_local_asset_upload.sh
./scripts/validate_download_capture.sh
```

Expected output contains `[OK]` lines for gateway reachability, service health, local upload, and download-capture record listing.

## Tested Environment

The local reproduction path has been prepared for Linux-based Docker hosts and Docker Desktop. A typical reviewer machine should provide:

- Docker Engine 24 or newer, or Docker Desktop with Compose v2;
- at least 4 CPU cores available to Docker;
- at least 6 GB RAM available to Docker;
- at least 8 GB free disk space for images, build cache, and persistent volumes;
- `git`, `curl`, and a POSIX shell for the validation scripts.

On Windows, run the validation scripts from WSL or Git Bash. PowerShell can be used for cloning, copying `.env.example`, and starting Docker Compose.

## Network Ports

The local stack exposes the public gateway on port `12000`.

| Port | Service | Purpose |
| --- | --- | --- |
| `12000` | Nginx gateway | Browser UI and routed API access |

Internal container ports for EDC, local-assets, download-sink, PostgreSQL, and Nginx are kept on the Docker network and do not need to be exposed on the host for the local reproduction workflow.

## Expected Startup Time

The first run builds the local auxiliary images and may take several minutes depending on network and Docker cache state. Subsequent runs normally start faster. The EDC runtime can take one or two minutes to pass its health check after PostgreSQL becomes healthy.

## Expected Validation Output

The scripts are intentionally concise. A successful run should include messages equivalent to:

```text
[OK] gateway reachable
[OK] EDC runtime healthy
[OK] local-assets service healthy
[OK] local asset upload accepted
[OK] download-sink ingestion accepted
[OK] download-sink record listed
```

Exact identifiers and generated URLs may differ between runs.

## Troubleshooting

If Docker Compose fails before containers start, run:

```bash
docker compose --env-file .env -f docker-compose.yaml config
```

If the EDC health check fails, inspect the runtime and database logs:

```bash
docker compose --env-file .env -f docker-compose.yaml logs conectoruc3m edc-postgres
```

If the gateway is not reachable, check that port `12000` is not already in use:

```bash
docker compose --env-file .env -f docker-compose.yaml ps
```

If validation scripts fail on Windows, rerun them from WSL or Git Bash so that shell paths and `curl` behavior match the documented reproduction environment.

## 5. Stop

```bash
docker compose --env-file .env -f docker-compose.yaml down
```

Avoid `down -v` unless all local persistent state can be deleted.

## Notes

- The reproduction path is intentionally local and does not require ArcGIS Enterprise.
- Institutional profiles are documented separately and may require real DNS names, ArcGIS configuration, and production secrets.
- Some historical demo profiles expose credentials through browser-visible variables. Treat those profiles as local-only demonstrations.
