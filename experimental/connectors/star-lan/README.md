# Star LAN deployment

This layout splits the Star proof of concept into independent LAN deployments:

- `a/`: provider or consumer node `conectorstar-a`
- `b/`: provider or consumer node `conectorstar-b`
- `coordinator/`: Star coordinator service

Recommended topology on the same local network:

- Machine A: run `a/docker-compose.yaml`
- Machine B: run `b/docker-compose.yaml`
- Machine C or Machine A/B: run `coordinator/docker-compose.yaml`

The coordinator can share the same machine as `A` or `B` without conflicts because it only needs port `12030`.

Example LAN IPs:

- `conectorstar-a`: `192.168.1.10`
- `conectorstar-b`: `192.168.1.11`
- `coordinator`: `192.168.1.10` or `192.168.1.12`

Start examples:

```powershell
Copy-Item experimental/connectors/star-lan/a/.env.example experimental/connectors/star-lan/a/.env
docker compose --env-file experimental/connectors/star-lan/a/.env -f experimental/connectors/star-lan/a/docker-compose.yaml up -d --build
```

```powershell
Copy-Item experimental/connectors/star-lan/b/.env.example experimental/connectors/star-lan/b/.env
docker compose --env-file experimental/connectors/star-lan/b/.env -f experimental/connectors/star-lan/b/docker-compose.yaml up -d --build
```

```powershell
Copy-Item experimental/connectors/star-lan/coordinator/.env.example experimental/connectors/star-lan/coordinator/.env
docker compose --env-file experimental/connectors/star-lan/coordinator/.env -f experimental/connectors/star-lan/coordinator/docker-compose.yaml up -d --build
```

Notes:

- Replace the sample IPs in each `.env` with the real LAN IP of each host.
- `STAR_CONNECTOR_DIRECTORY_JSON` must point to the public DSP URLs reachable from the other hosts.
- `STAR_COORDINATOR_URL` and `STAR_COORDINATOR_STATUS_BASE_URL` must point to the machine where the coordinator is running.
- If the coordinator runs on the same machine as `A`, keep the coordinator IP in both `a/.env` and `b/.env` pointing to Machine A.
