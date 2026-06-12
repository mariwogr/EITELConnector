# Deployment Profiles

## Supported Reproduction Profile

| File | Purpose |
| --- | --- |
| `docker-compose.yaml` | Local TOPIC Connector reproduction stack for SoftwareX review and smoke testing |

## Optional Supported Examples

| File | Purpose |
| --- | --- |
| `experimental/connectors/normal/docker-compose.yaml` | Standalone non-ArcGIS connector profile |

## Institutional Profiles

| File | Purpose |
| --- | --- |
| `institutional-profiles/uc3m/docker-compose.production.yaml` | UC3M production-like deployment |
| `institutional-profiles/fuenlabrada/docker-compose.production.yaml` | Fuenlabrada production-like deployment |

These profiles preserve real deployment engineering patterns but are not the recommended first path for external reviewers.

## Experimental Profiles

| Path | Purpose |
| --- | --- |
| `experimental/connectors/star` | ArcGIS/trust-oriented experimental profile |
| `experimental/connectors/dual` | Local two-profile proof-of-concept |
| `experimental/connectors/star-pair` | Two STAR connector proof-of-concept |
| `experimental/connectors/star-lan` | LAN-oriented STAR proof-of-concept |
| `caas` | Connector-as-a-Service experiments and auxiliary services |

## Deprecated Profiles

| File | Status |
| --- | --- |
| `legacy/docker-compose-backup.yaml` | Legacy backup profile retained for traceability |
