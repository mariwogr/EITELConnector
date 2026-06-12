# TOPIC Connector v1.0.4

SoftwareX repository layout release for the TOPIC Connector artifact.

## Highlights

- Refactors the manuscript toward the SoftwareX article structure.
- Aligns the reviewed artifact version across paper, README, CITATION metadata, changelog, and reproducibility guide.
- Shortens the related-work and workflow sections so the manuscript better matches the current validation evidence.
- Expands the software metadata table with SoftwareX-oriented fields.
- Expands the reproducibility guide with tested environment assumptions, port usage, expected startup behavior, expected validation output, and troubleshooting.
- Builds the primary local UI image from repository sources instead of using a moving `latest` image tag.
- Extends CI so the local reproduction stack is built and the functional smoke scripts are executed.
- Moves secondary connector profiles under `experimental/`.
- Moves production-like profiles under `institutional-profiles/`.
- Renames the Nginx gateway directory from `traefik/` to `gateway/`.
- Moves deprecated and historical deployment fragments under `legacy/`.

## Review Path

```bash
git clone https://github.com/krgroup/TOPIC-Connector.git
cd TOPIC-Connector
git checkout v1.0.4
cp .env.example .env
docker compose --env-file .env -f docker-compose.yaml up -d --build
./scripts/validate_stack.sh
./scripts/validate_local_asset_upload.sh
./scripts/validate_download_capture.sh
```

## Notes

The primary SoftwareX review path is the local Docker Compose stack in `docker-compose.yaml`. Institutional and experimental profiles remain in the repository for traceability, but they are not required for the artifact smoke tests.
