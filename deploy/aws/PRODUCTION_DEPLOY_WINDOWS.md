# AWS Windows Server Deployment (PowerShell)

## 1) Prerequisites
Run PowerShell as Administrator:
```powershell
winget install --id Git.Git -e --source winget
winget install --id Docker.DockerDesktop -e --source winget
winget install --id NSSM.NSSM -e --source winget
```

Then reboot if requested and ensure Docker is running in Linux containers mode.

## 2) Clone repo
```powershell
New-Item -ItemType Directory -Path "C:\eitel" -Force | Out-Null
Set-Location "C:\eitel"
git clone https://github.com/mariwogr/EITELConnector.git
Set-Location "C:\eitel\EITELConnector"
```

## 3) Configure production env
```powershell
Copy-Item ".env.production.example" ".env.production"
notepad ".env.production"
```

Set secure values:
- `POSTGRES_PASSWORD`
- `EDC_API_AUTH_KEY`

Important:
- If a secret contains `$`, write it as `$$` in `.env.production`.
- This avoids warnings like: `The "bKC" variable is not set...`.

## 4) Build and start stack
```powershell
docker compose --env-file .env.production -f docker-compose.production.yaml build --no-cache
docker compose --env-file .env.production -f docker-compose.production.yaml up -d
docker compose --env-file .env.production -f docker-compose.production.yaml ps
```

Note:
- The production Postgres init script is `deploy/aws/init-conectoruc3m.sql` and creates `conectoruc3m_db`.

## 5) Validate locally on server
```powershell
Invoke-WebRequest "http://localhost:12000/health" -UseBasicParsing
Invoke-WebRequest "http://localhost:12000/conectoruc3m/" -UseBasicParsing
Invoke-WebRequest "http://localhost:12000/conectoruc3m/api/check/health" -UseBasicParsing
```

## 6) Keep it always running as a Windows service
Create launcher script:
```powershell
@'
Set-Location "C:\eitel\EITELConnector"
docker compose --env-file .env.production -f docker-compose.production.yaml up -d
while ($true) { Start-Sleep -Seconds 300 }
'@ | Set-Content -Path "C:\eitel\EITELConnector\start-eitel.ps1" -Encoding UTF8
```

Install service with NSSM:
```powershell
nssm install EITELConnector "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" "-ExecutionPolicy Bypass -File C:\eitel\EITELConnector\start-eitel.ps1"
nssm set EITELConnector Start SERVICE_AUTO_START
nssm set EITELConnector AppExit Default Restart
nssm start EITELConnector
Get-Service EITELConnector
```

Ensure Docker service is automatic:
```powershell
Set-Service -Name com.docker.service -StartupType Automatic
Start-Service com.docker.service
```

## 7) Update procedure
```powershell
Set-Location "C:\eitel\EITELConnector"
git pull origin main
docker compose --env-file .env.production -f docker-compose.production.yaml up -d --build
```
