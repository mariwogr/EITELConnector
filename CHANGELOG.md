# Changelog

## v1.0.11 - 2026-06-15

CI isolation release.

### Changed

- Removes fixed container names from the primary Docker Compose stack so CI runs use isolated Compose project names.
- Sets a unique Compose project name in GitHub Actions.

## v1.0.10 - 2026-06-15

CI download-capture release.

### Fixed

- Preserves download-capture validation identifiers when ingesting payloads through the download-sink service.
- Sends validation identifiers as query parameters in the download-capture smoke test while retaining header fallback support.

## v1.0.9 - 2026-06-13

CI readiness release.

### Changed

- Adds health checks for the local-assets and download-sink services in the primary Docker Compose stack.
- Splits functional smoke checks into separate GitHub Actions steps.
- Adds retry logic to smoke-test scripts to tolerate service startup timing in CI.

## v1.0.8 - 2026-06-13

CI smoke-check release.

### Fixed

- Uses `curl` rather than `wget` inside the EDC runtime container during stack validation.

## v1.0.7 - 2026-06-13

CI reproducibility release.

### Changed

- Builds the local EDC runtime from the repository Dockerfile in the primary Docker Compose stack.
- Increases the GitHub Actions timeout for the full local reproduction stack build.

## v1.0.6 - 2026-06-13

SoftwareX final alignment release.

### Changed

- Aligned the README manuscript title with the current paper title.
- Strengthened the manuscript impact statement without expanding the validation claims.

## v1.0.5 - 2026-06-13

SoftwareX manuscript compaction release.

### Changed

- Rewrote the manuscript as a shorter SoftwareX-style software paper.
- Added explicit capability, repository evidence, and validation-status mapping.
- Narrowed ArcGIS, contract-negotiation, and production-operation claims to match current evidence.
- Added the GitHub Actions CI badge to the README.

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
