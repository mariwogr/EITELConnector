# TOPIC Connector

[![CI](https://github.com/krgroup/TOPIC-Connector/actions/workflows/ci.yml/badge.svg)](https://github.com/krgroup/TOPIC-Connector/actions/workflows/ci.yml)

TOPIC Connector is a municipal-oriented toolkit for deploying and operating Eclipse Dataspace Components (EDC)-based data connectors. It packages a connector runtime, operator UI, local asset ingestion service, download-capture service, PostgreSQL persistence, and Nginx gateway profiles into reproducible deployment artifacts.

The repository was originally developed under the EITELConnector name. EITEL refers to the broader research and engineering ecosystem; TOPIC Connector is the bounded software artifact released for review, citation, and reuse.

## SoftwareX Artifact

This repository contains the software artifact described in:

> TOPIC Connector: A Reproducible Toolkit for Early-Stage Municipal Data-Space Connectors

Recommended artifact version:

- Repository: https://github.com/krgroup/TOPIC-Connector
- Release: `v1.0.6`
- License: Apache-2.0
- Support contact: Mario Garcia Rodriguez, Universidad Carlos III de Madrid

The recommended reproduction path for reviewers is the local Docker Compose stack in [docker-compose.yaml](docker-compose.yaml). Production profiles and experimental profiles are kept for traceability, but they are not the primary SoftwareX reproduction path.

## Core Components

| Component | Technology | Purpose |
| --- | --- | --- |
| EDC runtime | Java / Eclipse EDC | Connector core for assets, policies, contracts, negotiations, and transfers |
| Management UI | HTML / CSS / JavaScript, served by Nginx | Operator interface for publication, catalog, contracts, transfers, and ArcGIS-oriented workflows |
| local-assets | Python / FastAPI | Local file upload and controlled publication support |
| download-sink | Python / FastAPI | Transfer/download capture and traceable record listing |
| PostgreSQL | PostgreSQL | Runtime persistence for connector state |
| Gateway | Nginx | Stable public routing for UI, management, DSP, local-assets, and download-sink endpoints |

## Repository Structure

| Path | Role | Stability |
| --- | --- | --- |
| [docker-compose.yaml](docker-compose.yaml) | Local reproduction stack | Supported SoftwareX path |
| [caas/edc-ui](caas/edc-ui) | Management UI | Supported |
| [caas/control-plane](caas/control-plane) | local-assets API and publication support | Supported |
| [caas/download-sink](caas/download-sink) | Transfer/download capture service | Supported |
| [deploy](deploy) | EDC runtime Dockerfile and deployment notes | Supported |
| [gateway](gateway) | Nginx gateway configuration | Supported |
| [institutional-profiles](institutional-profiles) | UC3M and Fuenlabrada production-like profiles | Institutional profiles, not SoftwareX baseline |
| [experimental/connectors](experimental/connectors) | Normal, STAR, dual, pair, and LAN connector experiments | Experimental |
| [legacy](legacy) | Deprecated or historical deployment fragments | Deprecated |
| [paper](paper) | Manuscript sources | Documentation |

## Requirements

- Git
- Docker Engine
- Docker Compose plugin
- curl, for validation scripts

Optional for development:

- Python 3.11+
- Node.js, for frontend syntax checks

## Quick Start

Clone and start the local SoftwareX reproduction stack:

```powershell
git clone https://github.com/krgroup/TOPIC-Connector.git
cd TOPIC-Connector
Copy-Item .env.example .env
docker compose --env-file .env -f docker-compose.yaml up -d --build
```

On Linux or macOS:

```bash
git clone https://github.com/krgroup/TOPIC-Connector.git
cd TOPIC-Connector
cp .env.example .env
docker compose --env-file .env -f docker-compose.yaml up -d --build
```

Open the UI through the configured gateway, typically:

```text
http://localhost:12000/
```

## Reproducibility

The reproducibility guide is available in [docs/REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md).

Validation scripts:

```bash
./scripts/validate_stack.sh
./scripts/validate_local_asset_upload.sh
./scripts/validate_download_capture.sh
```

Expected checks include:

- gateway reachable;
- EDC runtime health endpoint reachable from the Docker network;
- local-assets service reachable;
- local file upload accepted;
- download-sink ingestion accepted and listed.

## Deployment Profiles

| Deployment | Purpose | Use for SoftwareX? |
| --- | --- | --- |
| `docker-compose.yaml` | Local UC3M-style reproduction stack | Yes |
| `experimental/connectors/normal/docker-compose.yaml` | Minimal standalone connector | Optional example |
| `experimental/connectors/star/docker-compose.yaml` | ArcGIS/trust-oriented profile | No, experimental |
| `experimental/connectors/dual/docker-compose.yaml` | Local two-profile PoC | No, experimental |
| `institutional-profiles/uc3m/docker-compose.production.yaml` | UC3M production-like deployment | No, institutional |
| `institutional-profiles/fuenlabrada/docker-compose.production.yaml` | Fuenlabrada production-like deployment | No, institutional |
| `legacy/docker-compose-backup.yaml` | Legacy backup profile | No, deprecated |

## Configuration And Secrets

Use example files as templates:

- [.env.example](.env.example): local SoftwareX reproduction profile;
- [.env.production.example](.env.production.example): production-like institutional profile;
- [experimental/connectors/normal/.env.example](experimental/connectors/normal/.env.example);
- [experimental/connectors/star/.env.example](experimental/connectors/star/.env.example);
- [experimental/connectors/dual/.env.example](experimental/connectors/dual/.env.example).

Never commit real `.env` files, credentials, database dumps, generated local assets, or private Gaia-X credentials.

### Security Note About Frontend Demo Keys

Some local and historical profiles expose management or local-assets tokens to the browser through `NEXT_PUBLIC_*` variables. This is acceptable only for local demonstration profiles. Production deployments should place privileged EDC Management API access behind an authenticated backend or gateway layer; browser clients should not receive privileged management credentials.

## Production-Like Institutional Profiles

UC3M:

```powershell
Copy-Item .env.production.example .env.production
docker compose --env-file .env.production -f institutional-profiles/uc3m/docker-compose.production.yaml up -d --build
```

Fuenlabrada:

```powershell
Copy-Item .env.production.example .env.production
docker compose --env-file .env.production -f institutional-profiles/fuenlabrada/docker-compose.production.yaml up -d --build
```

Notes:

- both profiles publish `12000:80`, so they should not be started together on the same host without port changes;
- do not run `docker compose down -v` against production data unless the persistent state is intentionally being deleted;
- if ArcGIS UI variables change, recreate the UI container so `config.js` is regenerated.

## Citation

If you use TOPIC Connector, cite the release metadata in [CITATION.cff](CITATION.cff).

## License

TOPIC Connector is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
