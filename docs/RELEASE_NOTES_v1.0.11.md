# TOPIC Connector v1.0.11

CI isolation release for the TOPIC Connector SoftwareX artifact.

## Highlights

- Removes fixed container names from the primary Docker Compose stack so CI runs use isolated Compose project names.
- Sets a unique Compose project name in GitHub Actions.
- Keeps the reviewed artifact version aligned across paper, README, CITATION metadata, changelog, and reproducibility guide.

## Review Path

```bash
git clone https://github.com/krgroup/TOPIC-Connector.git
cd TOPIC-Connector
git checkout v1.0.11
cp .env.example .env
docker compose --env-file .env -f docker-compose.yaml up -d --build
./scripts/validate_stack.sh
./scripts/validate_local_asset_upload.sh
./scripts/validate_download_capture.sh
```

## Notes

The primary SoftwareX review path is the local Docker Compose stack in `docker-compose.yaml`. Institutional and experimental profiles remain in the repository for traceability, but they are not required for the artifact smoke tests.
