# TOPIC Connector v1.0.10

CI download-capture release for the TOPIC Connector SoftwareX artifact.

## Highlights

- Preserves download-capture validation identifiers when ingesting payloads through the download-sink service.
- Sends validation identifiers as query parameters in the download-capture smoke test while retaining header fallback support.
- Keeps the reviewed artifact version aligned across paper, README, CITATION metadata, changelog, and reproducibility guide.

## Review Path

```bash
git clone https://github.com/krgroup/TOPIC-Connector.git
cd TOPIC-Connector
git checkout v1.0.10
cp .env.example .env
docker compose --env-file .env -f docker-compose.yaml up -d --build
./scripts/validate_stack.sh
./scripts/validate_local_asset_upload.sh
./scripts/validate_download_capture.sh
```

## Notes

The primary SoftwareX review path is the local Docker Compose stack in `docker-compose.yaml`. Institutional and experimental profiles remain in the repository for traceability, but they are not required for the artifact smoke tests.
