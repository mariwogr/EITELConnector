# AWS Windows Server Deployment (PowerShell)

## 1) Prerequisites
Run PowerShell as Administrator:
```powershell
winget install --id Git.Git -e --source winget
winget install --id Docker.DockerDesktop -e --source winget
winget install --id NSSM.NSSM -e --source winget
```

Then reboot if requested and ensure Docker is running in Linux containers mode.

## 2) Docker Hub login
The EDC runtime image (`eitel/eclipse-edc-runtime`) is hosted on Docker Hub and requires authentication:
```powershell
docker login
```
Enter your Docker Hub username and password when prompted. This only needs to be done once per machine.

## 3) Clone repo
```powershell
New-Item -ItemType Directory -Path "C:\eitel" -Force | Out-Null
Set-Location "C:\eitel"
git clone https://github.com/mariwogr/EITELConnector.git
Set-Location "C:\eitel\EITELConnector"
```

## 4) Configure production env
```powershell
Copy-Item ".env.production.example" ".env.production"
notepad ".env.production"
```

Set secure values:
- `POSTGRES_PASSWORD`
- `EDC_API_AUTH_KEY`

ArcGIS Enterprise login gate (required for UI access control):
- `ARCGIS_AUTH_ENABLED=true`
- `ARCGIS_PORTAL_URL=https://gis.eiteldata.eu/arcgis`
- `ARCGIS_CLIENT_ID=<app-id-registrada-en-portal>`
- `ARCGIS_REDIRECT_URI=https://gis.eiteldata.eu/conectoruc3m/`
- `ARCGIS_REQUIRED_ORG_ID=<orgId-opcional>`
- `ARCGIS_REQUIRED_GROUP_ID=<groupId-opcional>`

Important:
- If a secret contains `$`, write it as `$$` in `.env.production`.
- This avoids warnings like: `The "bKC" variable is not set...`.

## 5) Build and start stack
```powershell
docker compose --env-file .env.production -f docker-compose.production.yaml build --no-cache
docker compose --env-file .env.production -f docker-compose.production.yaml up -d
docker compose --env-file .env.production -f docker-compose.production.yaml ps

# If ArcGIS variables changed, recreate UI so config.js is regenerated
docker compose --env-file .env.production -f docker-compose.production.yaml up -d --build --force-recreate conectoruc3m-ui
```

Persistence rule (important):
- Do NOT run `docker compose down -v` in production.
- Do NOT remove Docker volume `conectoruc3m_pg_data`.
- Contracts, negotiations and transfers are stored in PostgreSQL volume `conectoruc3m_pg_data` and must be kept between deploys.

Note:
- The production Postgres init script is `deploy/aws/init-conectoruc3m.sql` and creates `conectoruc3m_db`.

## 6) Validate locally on server
```powershell
Invoke-WebRequest "http://localhost:12000/health" -UseBasicParsing
Invoke-WebRequest "http://localhost:12000/conectoruc3m/" -UseBasicParsing
Invoke-WebRequest "http://localhost:12000/conectoruc3m/api/check/health" -UseBasicParsing
```

## 7) Keep it always running after reboot (Windows Task Scheduler watchdog)
Create launcher script:
```powershell
@'
Set-Location "C:\eitel\EITELConnector"
docker compose --env-file .env.production -f docker-compose.production.yaml up -d
'@ | Set-Content -Path "C:\eitel\EITELConnector\start-eitel.ps1" -Encoding UTF8
```

Register a watchdog task (runs at startup and every minute):
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\eitel\EITELConnector\start-eitel.ps1"
$triggerStartup = New-ScheduledTaskTrigger -AtStartup
$triggerMinute = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "EITELConnector-Watchdog" -Action $action -Trigger @($triggerStartup,$triggerMinute) -Settings $settings -RunLevel Highest -User "SYSTEM" -Force
Start-ScheduledTask -TaskName "EITELConnector-Watchdog"
Get-ScheduledTask -TaskName "EITELConnector-Watchdog"
```

Ensure Docker service is automatic:
```powershell
Set-Service -Name com.docker.service -StartupType Automatic
Start-Service com.docker.service
```

Note:
- This watchdog is idempotent: repeated `docker compose ... up -d` is safe and only reconciles desired state.

## 8) Update procedure
```powershell
Set-Location "C:\eitel\EITELConnector"
git pull origin main
docker compose --env-file .env.production -f docker-compose.production.yaml up -d --build
```

This update flow keeps the PostgreSQL volume and preserves existing connector state.
