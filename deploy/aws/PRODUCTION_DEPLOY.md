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
nano .env.production
```

## 3) Start production stack
```bash
docker compose --env-file .env.production -f docker-compose.production.yaml up -d
```

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
sudo systemctl restart eitel-connector
```

## 7) If machine hangs/crashes
- On instance reboot, `systemd` + Docker restart policies restore services automatically.
- For higher availability, use at least 2 EC2 instances behind ALB in an Auto Scaling Group.
- Persist PostgreSQL volume (`pg_data`) on durable storage (EBS). Consider DB backups/snapshots.
