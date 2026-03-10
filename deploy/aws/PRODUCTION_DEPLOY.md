# AWS Production Deployment (gis.eiteldata.eu/conectoruc3m)

## 1) Prerequisites on EC2
- Docker Engine + Docker Compose plugin installed.
- Security Group allows inbound from ALB to instance port `12000`.
- ALB target group forwards to instance `:12000`.
- DNS `gis.eiteldata.eu` points to ALB.

## 2) Clone and configure
```bash
sudo mkdir -p /opt/eitel
sudo chown -R $USER:$USER /opt/eitel
cd /opt/eitel
git clone https://github.com/mariwogr/EITELConnector.git
cd EITELConnector
cp .env.production.example .env.production
# Edit and set secure secrets:
# - POSTGRES_PASSWORD
# - EDC_API_AUTH_KEY
# ArcGIS login gate (required for UI access control):
# - ARCGIS_AUTH_ENABLED=true
# - ARCGIS_PORTAL_URL=https://gis.eiteldata.eu/arcgis
# - ARCGIS_REDIRECT_URI=https://gis.eiteldata.eu/conectoruc3m/
nano .env.production
```

## 3) Start production stack
```bash
docker compose --env-file .env.production -f docker-compose.production.yaml up -d
```

If you changed ArcGIS variables, recreate UI so `config.js` is regenerated:
```bash
docker compose --env-file .env.production -f docker-compose.production.yaml up -d --build --force-recreate conectoruc3m-ui
```

Persistence rule (important):
- Do NOT run `docker compose down -v` in production.
- Do NOT run `docker volume rm conectoruc3m_pg_data`.
- Contracts, negotiations and transfers are stored in PostgreSQL volume `conectoruc3m_pg_data` and must be kept between deploys.

## 4) Validate
```bash
curl -i http://localhost:12000/health
curl -i http://localhost:12000/conectoruc3m/
curl -i http://localhost:12000/conectoruc3m/api/check/health
```

## 5) Run as persistent service (auto start + auto recover)
```bash
sudo cp deploy/systemd/eitel-connector.service /etc/systemd/system/eitel-connector.service
sudo systemctl daemon-reload
sudo systemctl enable --now eitel-connector
sudo systemctl status eitel-connector
```

Notes:
- Containers already use `restart: unless-stopped`.
- `systemd` ensures stack starts on reboot and can be restarted with:
```bash
sudo systemctl restart eitel-connector
```

## 6) Upgrade procedure
```bash
cd /opt/eitel/EITELConnector
git pull
docker compose --env-file .env.production -f docker-compose.production.yaml up -d --build
```

This upgrade flow keeps the PostgreSQL volume and preserves existing connector state.

## 7) If machine hangs/crashes
- On instance reboot, `systemd` + Docker restart policies restore services automatically.
- For higher availability, use at least 2 EC2 instances behind ALB in an Auto Scaling Group.
- Persist PostgreSQL volume (`conectoruc3m_pg_data`) on durable storage (EBS). Consider DB backups/snapshots.
