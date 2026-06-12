# Changelog

## v1.0.4 - 2026-06-12

SoftwareX repository layout release.

### Changed

- Moved secondary connector profiles under `experimental/`.
- Moved production-like profiles under `institutional-profiles/`.
- Renamed the Nginx gateway directory from `traefik/` to `gateway/`.
- Moved deprecated and historical deployment fragments under `legacy/`.
- Updated documentation and CI paths for the new artifact layout.

## v1.0.3 - 2026-06-12

SoftwareX alignment release.

### Changed

- Shortened the manuscript related-work and workflow sections to better match the validation evidence.
- Expanded the manuscript software metadata table with SoftwareX-oriented fields.
- Removed pending DOI wording from the manuscript and README.
- Added release notes for publishing the visible GitHub release.

## v1.0.2 - 2026-06-12

SoftwareX hardening release.

### Changed

- Reframed the manuscript around the SoftwareX software artifact structure.
- Expanded reproducibility documentation with requirements, ports, expected outputs, and troubleshooting.
- Aligned artifact metadata to a single review version.
- Removed the `latest` tag from the primary local UI Compose service by building the UI image locally.

## v1.0.1 - 2026-06-12

SoftwareX repository packaging release.

### Added

- SoftwareX-oriented README.
- Citation metadata.
- NOTICE, SECURITY, CONTRIBUTING, and reproducibility documentation.
- Validation scripts and sample data.
- CI workflow for Docker Compose and frontend syntax checks.

## v1.0.0 - 2026-06-12

Initial SoftwareX-oriented release.

### Added

- Eclipse EDC-based connector runtime deployment artifacts.
- Management UI for assets, policies, contracts, negotiations, and transfers.
- Local asset ingestion service.
- Download-capture service with transfer record listing.
- Nginx gateway profiles.
- UC3M and Fuenlabrada institutional deployment profiles.
- ArcGIS-oriented authentication and upload workflow.
- Apache-2.0 license.
