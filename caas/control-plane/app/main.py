from __future__ import annotations

from datetime import datetime, UTC
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from mimetypes import guess_type
from pathlib import Path
from typing import Literal
from uuid import uuid4
import base64
import json
import shutil
import smtplib

import yaml
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import DateTime, ForeignKey, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_prefix='CAAS_')

    base_domain: str = 'gis.eiteldata.eu'
    path_prefix_template: str = '/conector{tenant}'
    default_edc_api_key: str = 'change-me'
    default_db_password: str = 'change-me'

    # Imagen de runtime EDC propia de EITEL, basada en Eclipse Dataspace Connector.
    # Si no hay imagen publicada, el plan puede construir desde GitHub.
    edc_connector_image: str = 'eitel/eclipse-edc-runtime:0.16.0'
    edc_connector_source: Literal['image', 'git'] = 'image'
    edc_connector_git_url: str = 'https://github.com/eclipse-edc/Connector.git'
    edc_connector_git_ref: str = 'v0.16.0'
    edc_connector_git_dockerfile: str = 'deploy/Dockerfile'
    edc_ui_image: str = 'eitel/edc-ui:latest'

    sqlite_url: str = 'sqlite:///./data/caas.db'
    generated_output_dir: str = './data/generated'
    local_assets_dir: str = './data/local-assets'
    local_assets_internal_base_url: str = 'http://conectoruc3m-local-assets:8081/v1/local-assets/files'
    local_assets_public_base_url: str = 'https://gis.eiteldata.eu/conectoruc3m/local-assets/files'

    # SMTP para notificaciones de solicitudes de acceso (todos opcionales)
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = ''
    smtp_from: str = ''
    smtp_use_tls: bool = True
    connector_public_url: str = ''  # ej: https://gis.eiteldata.eu/conectoruc3m/edc-ui


settings = Settings()

# Load institutional logos as base64 at startup so emails embed them inline
def _b64_png(name: str) -> str:
    try:
        return base64.b64encode(
            (Path(__file__).parent / 'email_assets' / name).read_bytes()
        ).decode()
    except Exception:
        return ''

_LOGO_UC3M = _b64_png('uc3m.png')
_LOGO_FINANCIADO = _b64_png('financiado.png')
_LOGO_GOBIERNO = _b64_png('gobierno.png')
_LOGO_PLANREC = _b64_png('planrecuperacion.png')


def _email_footer_html() -> str:
    items = [
        (_LOGO_UC3M, 'UC3M'),
        (_LOGO_FINANCIADO, 'Financiado por la UE'),
        (_LOGO_GOBIERNO, 'Gobierno de España'),
        (_LOGO_PLANREC, 'Plan de Recuperación'),
    ]
    cells = ''.join(
        f'<td align="center"><img src="data:image/png;base64,{b64}" alt="{alt}" style="height:44px"/></td>'
        if b64 else f'<td align="center" style="color:#888;font-size:11px">{alt}</td>'
        for b64, alt in items
    )
    return (
        '<hr style="border:none;border-top:1px solid #ddd;margin-top:24px"/>'
        f'<table border="0" cellpadding="8" cellspacing="0" style="width:100%;margin-top:8px">'
        f'<tr>{cells}</tr></table>'
    )


app = FastAPI(title='EITEL Connector CaaS Control Plane', version='0.2.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

templates = Jinja2Templates(directory=str(Path(__file__).parent / 'templates'))
app.mount('/static', StaticFiles(directory=str(Path(__file__).parent / 'static')), name='static')

engine = create_engine(settings.sqlite_url, connect_args={'check_same_thread': False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class TenantModel(Base):
    __tablename__ = 'tenants'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    plans: Mapped[list['PlanModel']] = relationship(back_populates='tenant_ref')


class PlanModel(Base):
    __tablename__ = 'plans'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey('tenants.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    participant_id: Mapped[str] = mapped_column(String(120))
    compose_yaml: Mapped[str] = mapped_column(Text)
    ui_url: Mapped[str] = mapped_column(String(300))
    dsp_url: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(30), default='planned')

    tenant_ref: Mapped[TenantModel] = relationship(back_populates='plans')


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event('startup')
def startup_event():
    Base.metadata.create_all(bind=engine)
    Path(settings.generated_output_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.local_assets_dir).mkdir(parents=True, exist_ok=True)
    _load_download_sink_records()
    _load_local_secret_records()
    _load_asset_bundle_records()
    _load_access_request_records()
    _load_transfer_event_records()


class TenantCreate(BaseModel):
    tenant: str = Field(min_length=2, max_length=50, pattern=r'^[a-z0-9-]+$')
    display_name: str = Field(min_length=2, max_length=100)


class ConnectorPlanRequest(BaseModel):
    deployment_mode: Literal['single-host-docker'] = 'single-host-docker'
    participant_id: str | None = None
    api_key: str | None = None
    db_password: str | None = None


dummy_sink_records: list[dict] = []
MAX_DUMMY_RECORDS = 200
local_download_records: list[dict] = []
MAX_LOCAL_DOWNLOAD_RECORDS = 200
local_secret_records: dict[str, str] = {}
asset_bundle_records: list[dict] = []
MAX_ASSET_BUNDLE_RECORDS = 300
access_request_records: list[dict] = []
MAX_ACCESS_REQUEST_RECORDS = 800
transfer_event_records: list[dict] = []
MAX_TRANSFER_EVENT_RECORDS = 1000


def _download_sink_index_path() -> Path:
    return Path(settings.local_assets_dir) / 'download-sink' / 'index.json'


def _load_download_sink_records() -> None:
    path = _download_sink_index_path()
    try:
        if not path.exists():
            return
        parsed = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(parsed, list):
            local_download_records.clear()
            local_download_records.extend(parsed[-MAX_LOCAL_DOWNLOAD_RECORDS:])
    except Exception:
        local_download_records.clear()


def _save_download_sink_records() -> None:
    path = _download_sink_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = local_download_records[-MAX_LOCAL_DOWNLOAD_RECORDS:]
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')


def _local_secrets_index_path() -> Path:
    return Path(settings.local_assets_dir) / 'local-secrets' / 'index.json'


def _load_local_secret_records() -> None:
    path = _local_secrets_index_path()
    try:
        if not path.exists():
            local_secret_records.clear()
            return
        parsed = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(parsed, dict):
            local_secret_records.clear()
            for k, v in parsed.items():
                name = str(k or '').strip()
                if not name:
                    continue
                local_secret_records[name] = str(v or '')
    except Exception:
        local_secret_records.clear()


def _save_local_secret_records() -> None:
    path = _local_secrets_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {k: v for k, v in local_secret_records.items() if str(k).strip()}
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')


def _asset_bundle_index_path() -> Path:
    return Path(settings.local_assets_dir) / 'asset-bundles' / 'index.json'


def _load_asset_bundle_records() -> None:
    path = _asset_bundle_index_path()
    try:
        if not path.exists():
            asset_bundle_records.clear()
            return
        parsed = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(parsed, list):
            filtered = [row for row in parsed if isinstance(row, dict) and str(row.get('assetId') or '').strip()]
            asset_bundle_records.clear()
            asset_bundle_records.extend(filtered[-MAX_ASSET_BUNDLE_RECORDS:])
    except Exception:
        asset_bundle_records.clear()


def _save_asset_bundle_records() -> None:
    path = _asset_bundle_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [row for row in asset_bundle_records[-MAX_ASSET_BUNDLE_RECORDS:] if isinstance(row, dict)]
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')


def _access_request_index_path() -> Path:
    return Path(settings.local_assets_dir) / 'access-requests' / 'index.json'


def _transfer_event_index_path() -> Path:
    return Path(settings.local_assets_dir) / 'transfer-events' / 'index.json'


def _load_transfer_event_records() -> None:
    path = _transfer_event_index_path()
    try:
        if not path.exists():
            transfer_event_records.clear()
            return
        parsed = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(parsed, list):
            transfer_event_records.clear()
            transfer_event_records.extend([row for row in parsed if isinstance(row, dict)][-MAX_TRANSFER_EVENT_RECORDS:])
    except Exception:
        transfer_event_records.clear()


def _save_transfer_event_records() -> None:
    path = _transfer_event_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [row for row in transfer_event_records[-MAX_TRANSFER_EVENT_RECORDS:] if isinstance(row, dict)]
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')


def _send_access_request_email(row: dict) -> dict:
    """Send an email notification to the asset owner when a new access request arrives.
    Returns a small delivery status so the UI can surface SMTP configuration issues."""
    if not settings.smtp_host or not settings.smtp_from:
        return {'sent': False, 'reason': 'smtp-not-configured'}
    to_addr = str(row.get('ownerEmail') or '').strip()
    if not to_addr:
        return {'sent': False, 'reason': 'owner-email-missing'}
    try:
        asset_label = str(row.get('assetTitle') or row.get('assetId') or '')
        subject = f'[EITEL] Nueva solicitud de acceso: {asset_label}'
        footer_html = _email_footer_html()
        body_html = f"""<html><body style="font-family:sans-serif;color:#222">
<h2 style="color:#1a5276">Nueva solicitud de acceso a asset privado</h2>
<table border="0" cellpadding="6" style="border-collapse:collapse;min-width:400px">
  <tr><td><b>Asset:</b></td><td>{asset_label}</td></tr>
  <tr><td><b>Solicitante:</b></td><td>{row.get('requesterName', '')} &lt;{row.get('requesterEmail', '')}&gt;</td></tr>
  <tr><td><b>Organización:</b></td><td>{row.get('requesterOrg', '') or '-'}</td></tr>
  <tr><td><b>Finalidad:</b></td><td>{row.get('purpose', '')}</td></tr>
  <tr><td><b>Duración solicitada:</b></td><td>{row.get('requestedDuration', '') or '-'}</td></tr>
  <tr><td><b>Mensaje adicional:</b></td><td>{row.get('message', '') or '-'}</td></tr>
  <tr><td><b>Fecha:</b></td><td>{row.get('createdAt', '')}</td></tr>
  <tr><td><b>ID solicitud:</b></td><td style="font-family:monospace">{row.get('requestId', '')}</td></tr>
</table>
{footer_html}
</body></html>"""
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = settings.smtp_from
        msg['To'] = to_addr
        msg.attach(MIMEText(body_html, 'html', 'utf-8'))
        if settings.smtp_use_tls:
            smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
        else:
            smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10)
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.sendmail(settings.smtp_from, [to_addr], msg.as_string())
        smtp.quit()
        return {'sent': True, 'to': to_addr, 'from': settings.smtp_from}
    except Exception as exc:
        print(f'[WARN] Email notification failed: {exc}')
        return {'sent': False, 'reason': 'send-failed', 'error': str(exc)}


def _send_decision_email(row: dict, decision: str) -> dict:
    """Send an email to the requester when their access request is approved or rejected."""
    if not settings.smtp_host or not settings.smtp_from:
        return {'sent': False, 'reason': 'smtp-not-configured'}
    to_addr = str(row.get('requesterEmail') or '').strip()
    if not to_addr:
        return {'sent': False, 'reason': 'requester-email-missing'}
    try:
        asset_label = str(row.get('assetTitle') or row.get('assetId') or '')
        is_approved = decision == 'approved'
        decision_es = 'aprobada' if is_approved else 'rechazada'
        subject = f'[EITEL] Tu solicitud de acceso ha sido {decision_es}: {asset_label}'
        color = '#1e8449' if is_approved else '#c0392b'
        reason_row = (
            f'<tr><td><b>Motivo:</b></td><td>{row.get("decisionReason", "") or "-"}</td></tr>'
            if row.get('decisionReason') else ''
        )
        footer_html = _email_footer_html()
        body_html = f"""<html><body style="font-family:sans-serif;color:#222">
<h2 style="color:{color}">Tu solicitud de acceso ha sido <b>{decision_es}</b></h2>
<table border="0" cellpadding="6" style="border-collapse:collapse;min-width:400px">
  <tr><td><b>Asset:</b></td><td>{asset_label}</td></tr>
  <tr><td><b>Solicitante:</b></td><td>{row.get('requesterName', '')}</td></tr>
  <tr><td><b>Organización:</b></td><td>{row.get('requesterOrg', '') or '-'}</td></tr>
  <tr><td><b>Finalidad solicitada:</b></td><td>{row.get('purpose', '') or '-'}</td></tr>
  <tr><td><b>Decisión:</b></td><td><b style="color:{color}">{decision_es.upper()}</b></td></tr>
  {reason_row}
  <tr><td><b>Fecha de decisión:</b></td><td>{row.get('decisionAt', '')}</td></tr>
  <tr><td><b>ID solicitud:</b></td><td style="font-family:monospace">{row.get('requestId', '')}</td></tr>
</table>
{footer_html}
</body></html>"""
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = settings.smtp_from
        msg['To'] = to_addr
        msg.attach(MIMEText(body_html, 'html', 'utf-8'))
        if settings.smtp_use_tls:
            smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
        else:
            smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10)
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.sendmail(settings.smtp_from, [to_addr], msg.as_string())
        smtp.quit()
        return {'sent': True, 'to': to_addr, 'from': settings.smtp_from}
    except Exception as exc:
        print(f'[WARN] Decision email notification failed: {exc}')
        return {'sent': False, 'reason': 'send-failed', 'error': str(exc)}


def _load_access_request_records() -> None:
    path = _access_request_index_path()
    try:
        if not path.exists():
            access_request_records.clear()
            return
        parsed = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(parsed, list):
            filtered = [
                row
                for row in parsed
                if isinstance(row, dict)
                and str(row.get('requestId') or '').strip()
                and str(row.get('assetId') or '').strip()
            ]
            access_request_records.clear()
            access_request_records.extend(filtered[-MAX_ACCESS_REQUEST_RECORDS:])
    except Exception:
        access_request_records.clear()


def _save_access_request_records() -> None:
    path = _access_request_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [row for row in access_request_records[-MAX_ACCESS_REQUEST_RECORDS:] if isinstance(row, dict)]
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')


def _safe_upload_name(name: str) -> str:
    candidate = Path(name or 'upload.bin').name.strip()
    return candidate or 'upload.bin'


def _safe_local_download_filename(content_disposition: str, fallback: str = 'download.bin') -> str:
    value = str(content_disposition or '')
    filename = ''
    if 'filename*=' in value:
        try:
            encoded = value.split('filename*=')[-1].split(';')[0].strip().strip('"')
            if "''" in encoded:
                encoded = encoded.split("''", 1)[1]
            filename = encoded
        except Exception:
            filename = ''
    if not filename and 'filename=' in value:
        try:
            filename = value.split('filename=')[-1].split(';')[0].strip().strip('"')
        except Exception:
            filename = ''
    return _safe_upload_name(filename or fallback)


def _prefix_for(tenant: str) -> str:
    return settings.path_prefix_template.format(tenant=tenant)


def _participant_id(tenant: str, provided: str | None) -> str:
    return provided or f'{tenant}-connector'


def _validate_connector_source_settings() -> None:
    if settings.edc_connector_source == 'git':
        git_url = settings.edc_connector_git_url.strip()

        if (
            'your-org/your-edc-runtime' in git_url
            or '<' in git_url
            or '>' in git_url
            or 'tu-org' in git_url
        ):
            raise HTTPException(
                status_code=400,
                detail='CAAS_EDC_CONNECTOR_GIT_URL no está configurada con un repositorio real.',
            )

        if settings.edc_connector_git_dockerfile.strip() == 'Dockerfile' and 'eclipse-edc/Connector' in settings.edc_connector_git_url:
            raise HTTPException(
                status_code=400,
                detail=(
                    'El repo eclipse-edc/Connector no suele ser un runtime Docker desplegable por sí solo. '
                    'Configura CAAS_EDC_CONNECTOR_GIT_DOCKERFILE con una ruta real o usa un repo runtime wrapper/fork con Dockerfile.'
                ),
            )


def _compose_for_tenant(tenant: str, participant_id: str, api_key: str, db_password: str) -> dict:
    prefix = _prefix_for(tenant)
    db_name = f'{tenant}_db'

    connector_service: dict = {
        'depends_on': {f'{tenant}-postgres': {'condition': 'service_healthy'}},
        'environment': {
            'EDC_PARTICIPANT_ID': participant_id,
            'WEB_HTTP_PORT': 11000,
            'WEB_HTTP_PATH': '/api',
            'WEB_HTTP_CONTROL_PORT': 11001,
            'WEB_HTTP_CONTROL_PATH': '/api/control',
            'WEB_HTTP_MANAGEMENT_PORT': 11002,
            'WEB_HTTP_MANAGEMENT_PATH': '/api/management',
            'WEB_HTTP_PROTOCOL_PORT': 11003,
            'WEB_HTTP_PROTOCOL_PATH': '/api/v1/dsp',
            'EDC_DSP_CALLBACK_ADDRESS': f'https://{settings.base_domain}{prefix}/api/v1/dsp',
            'EDC_MANAGEMENT_CONTEXT_ENABLED': 'true',
            'EDC_TRANSFER_PROXY_TOKEN_SIGNER_PRIVATEKEY_ALIAS': 'private-key',
            'EDC_TRANSFER_PROXY_TOKEN_VERIFIER_PUBLICKEY_ALIAS': 'public-key',
            'EDC_JDBC_URL': f'jdbc:postgresql://{tenant}-postgres:5432/{db_name}',
            'EDC_JDBC_USER': 'postgres',
            'EDC_JDBC_PASSWORD': db_password,
            'EDC_API_AUTH_KEY': api_key,
            'EDC_UI_WRAPPER_ENABLED': 'true',
            'EDC_WEB_REST_CORS_ENABLED': 'true',
            'EDC_WEB_REST_CORS_HEADERS': 'origin,content-type,accept,x-api-key,authorization',
            'EDC_WEB_REST_CORS_METHODS': 'GET,POST,PUT,DELETE,OPTIONS',
            'EDC_WEB_REST_CORS_ORIGINS': f'https://{settings.base_domain}',
        },
        'networks': ['edc-net'],
    }

    if settings.edc_connector_source == 'git':
        connector_service['build'] = {
            'context': f'{settings.edc_connector_git_url}#{settings.edc_connector_git_ref}',
            'dockerfile': settings.edc_connector_git_dockerfile,
        }
        connector_service['image'] = settings.edc_connector_image
    else:
        connector_service['image'] = settings.edc_connector_image

    return {
        'services': {
            f'{tenant}-postgres': {
                'image': 'postgres:15-alpine',
                'environment': {
                    'POSTGRES_USER': 'postgres',
                    'POSTGRES_PASSWORD': db_password,
                },
                'command': (
                    f"sh -c \"echo 'CREATE DATABASE {db_name};' "
                    " > /docker-entrypoint-initdb.d/init.sql && docker-entrypoint.sh postgres\""
                ),
                'healthcheck': {
                    'test': ['CMD-SHELL', 'pg_isready -U postgres'],
                    'interval': '5s',
                    'timeout': '5s',
                    'retries': 5,
                },
                'networks': ['edc-net'],
            },
            f'{tenant}-connector': connector_service,
            f'{tenant}-ui': {
                'image': settings.edc_ui_image,
                'depends_on': [f'{tenant}-connector'],
                'environment': {
                    'NEXT_PUBLIC_MANAGEMENT_API_URL': f'{prefix}/api/management',
                    'NEXT_PUBLIC_MANAGEMENT_API_AUTH_KEY': api_key,
                    'NEXT_PUBLIC_CONNECTOR_NAME': tenant.upper(),
                    'EDC_UI_MANAGEMENT_API_URL': f'http://{tenant}-connector:11002/api/management',
                    'EDC_UI_MANAGEMENT_API_AUTH_KEY': api_key,
                },
                'networks': ['edc-net'],
            },
        },
        'networks': {'edc-net': {'driver': 'bridge'}},
    }


@app.get('/', response_class=HTMLResponse)
def ui_home(request: Request):
    return templates.TemplateResponse('index.html', {'request': request})


@app.get('/health')
def health():
    return {'ok': True, 'service': 'eitel-caas-control-plane'}


@app.api_route('/v1/dummy-sink/ingest', methods=['POST', 'PUT'])
async def dummy_sink_ingest(request: Request):
    content_type = request.headers.get('content-type', '')
    payload: object
    try:
        if 'application/json' in content_type:
            payload = await request.json()
        else:
            raw = await request.body()
            payload = raw.decode('utf-8', errors='replace')
    except Exception:
        payload = '<unreadable payload>'

    record = {
        'received_at': datetime.now(UTC).isoformat(),
        'method': request.method,
        'path': str(request.url.path),
        'query': str(request.url.query),
        'content_type': content_type,
        'headers': {
            k: v
            for k, v in request.headers.items()
            if k.lower() in {'content-type', 'authorization', 'x-api-key'}
        },
        'payload': payload,
    }
    dummy_sink_records.append(record)
    if len(dummy_sink_records) > MAX_DUMMY_RECORDS:
        del dummy_sink_records[: len(dummy_sink_records) - MAX_DUMMY_RECORDS]

    return {'ok': True, 'stored': len(dummy_sink_records)}


@app.get('/v1/dummy-sink/records')
def dummy_sink_list_records():
    return {'count': len(dummy_sink_records), 'items': list(reversed(dummy_sink_records))}


@app.delete('/v1/dummy-sink/records')
def dummy_sink_clear_records():
    cleared = len(dummy_sink_records)
    dummy_sink_records.clear()
    return {'ok': True, 'cleared': cleared}


@app.post('/v1/local-assets/upload')
async def upload_local_asset(file: UploadFile = File(...)):
    filename = _safe_upload_name(file.filename or 'upload.bin')
    file_id = uuid4().hex
    target_dir = Path(settings.local_assets_dir) / file_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename

    with target_path.open('wb') as buffer:
        shutil.copyfileobj(file.file, buffer)

    path = f'/{file_id}/{filename}'
    size = target_path.stat().st_size
    media_type = file.content_type or guess_type(filename)[0] or 'application/octet-stream'
    return {
        'fileId': file_id,
        'filename': filename,
        'contentType': media_type,
        'bytes': size,
        'path': path,
        'internalBaseUrl': settings.local_assets_internal_base_url.rstrip('/'),
        'publicUrl': f"{settings.local_assets_public_base_url.rstrip('/')}{path}",
    }


@app.put('/v1/local-assets/upload-raw')
async def upload_local_asset_raw(request: Request, filename: str | None = None):
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail='Payload vacío')

    safe_filename = _safe_upload_name(filename or request.headers.get('x-filename') or 'upload.bin')
    file_id = uuid4().hex
    target_dir = Path(settings.local_assets_dir) / file_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_filename
    target_path.write_bytes(raw)

    path = f'/{file_id}/{safe_filename}'
    media_type = request.headers.get('content-type') or guess_type(safe_filename)[0] or 'application/octet-stream'
    return {
        'fileId': file_id,
        'filename': safe_filename,
        'contentType': media_type,
        'bytes': len(raw),
        'path': path,
        'internalBaseUrl': settings.local_assets_internal_base_url.rstrip('/'),
        'publicUrl': f"{settings.local_assets_public_base_url.rstrip('/')}{path}",
    }


@app.get('/v1/local-assets/files/{file_id}/{filename}')
def get_local_asset(file_id: str, filename: str):
    safe_name = _safe_upload_name(filename)
    target_path = (Path(settings.local_assets_dir) / file_id / safe_name).resolve()
    root_path = Path(settings.local_assets_dir).resolve()

    if root_path not in target_path.parents or not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail='Archivo local no encontrado')

    media_type = guess_type(safe_name)[0] or 'application/octet-stream'
    return FileResponse(target_path, media_type=media_type, filename=safe_name)


@app.api_route('/v1/local-assets/download-sink/ingest', methods=['POST', 'PUT'])
async def ingest_local_download(request: Request):
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail='Payload vacío en download-sink')

    contract_id = str(request.query_params.get('contractId') or '').strip()
    asset_id = str(request.query_params.get('assetId') or '').strip()
    transfer_id = str(request.query_params.get('transferId') or '').strip()
    content_type = request.headers.get('content-type', 'application/octet-stream')
    content_disposition = request.headers.get('content-disposition', '')
    filename = _safe_local_download_filename(content_disposition, 'download.bin')

    file_id = uuid4().hex
    target_dir = Path(settings.local_assets_dir) / 'download-sink' / file_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    target_path.write_bytes(raw)

    record = {
        'id': file_id,
        'received_at': datetime.now(UTC).isoformat(),
        'method': request.method,
        'contractId': contract_id,
        'assetId': asset_id,
        'transferId': transfer_id,
        'filename': filename,
        'bytes': len(raw),
        'contentType': content_type,
        'path': f'/v1/local-assets/download-sink/files/{file_id}/{filename}',
        'publicPath': f'/local-assets/download-sink/files/{file_id}/{filename}',
    }
    local_download_records.append(record)
    if len(local_download_records) > MAX_LOCAL_DOWNLOAD_RECORDS:
        del local_download_records[: len(local_download_records) - MAX_LOCAL_DOWNLOAD_RECORDS]
    _save_download_sink_records()

    return {
        'ok': True,
        'stored': len(local_download_records),
        'record': record,
    }


@app.get('/v1/local-assets/download-sink/records')
def list_local_download_records(contractId: str | None = None):
    items = list(reversed(local_download_records))
    if contractId:
        cid = str(contractId).strip()
        items = [r for r in items if str(r.get('contractId') or '').strip() == cid]
    return {'count': len(items), 'items': items}


@app.delete('/v1/local-assets/download-sink/records')
def clear_local_download_records():
    cleared = len(local_download_records)
    local_download_records.clear()
    _save_download_sink_records()
    return {'ok': True, 'cleared': cleared}


@app.get('/v1/local-assets/transfer-events')
def list_transfer_events(contractId: str | None = None, assetId: str | None = None, role: str | None = None):
    items = list(reversed(transfer_event_records))
    if contractId:
        target = str(contractId).strip()
        items = [row for row in items if str(row.get('contractId') or '').strip() == target]
    if assetId:
        target = str(assetId).strip()
        items = [row for row in items if str(row.get('assetId') or '').strip() == target]
    if role:
        target = str(role).strip().lower()
        items = [row for row in items if str(row.get('role') or '').strip().lower() == target]
    return {'count': len(items), 'items': items}


@app.post('/v1/local-assets/transfer-events')
async def create_transfer_event(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Payload invalido')

    now_iso = datetime.now(UTC).isoformat()
    row = {
        'eventId': uuid4().hex,
        'createdAt': now_iso,
        'role': str(payload.get('role') or '').strip(),
        'eventType': str(payload.get('eventType') or '').strip(),
        'status': str(payload.get('status') or '').strip(),
        'transferMode': str(payload.get('transferMode') or '').strip(),
        'transferType': str(payload.get('transferType') or '').strip(),
        'transferId': str(payload.get('transferId') or '').strip(),
        'contractId': str(payload.get('contractId') or '').strip(),
        'assetId': str(payload.get('assetId') or '').strip(),
        'counterPartyId': str(payload.get('counterPartyId') or '').strip(),
        'counterPartyAddress': str(payload.get('counterPartyAddress') or '').strip(),
        'destination': str(payload.get('destination') or '').strip(),
        'bytes': payload.get('bytes') if isinstance(payload.get('bytes'), int) else None,
        'filename': str(payload.get('filename') or '').strip(),
        'detail': str(payload.get('detail') or '').strip(),
    }
    transfer_event_records.append(row)
    if len(transfer_event_records) > MAX_TRANSFER_EVENT_RECORDS:
        del transfer_event_records[: len(transfer_event_records) - MAX_TRANSFER_EVENT_RECORDS]
    _save_transfer_event_records()
    return {'ok': True, 'eventId': row['eventId'], 'item': row}


@app.delete('/v1/local-assets/transfer-events')
def clear_transfer_events():
    cleared = len(transfer_event_records)
    transfer_event_records.clear()
    _save_transfer_event_records()
    return {'ok': True, 'cleared': cleared}


@app.get('/v1/local-assets/download-sink/files/{file_id}/{filename}')
def get_local_download_file(file_id: str, filename: str):
    safe_name = _safe_upload_name(filename)
    target_path = (Path(settings.local_assets_dir) / 'download-sink' / file_id / safe_name).resolve()
    root_path = (Path(settings.local_assets_dir) / 'download-sink').resolve()

    if root_path not in target_path.parents or not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail='Archivo de download-sink no encontrado')

    media_type = guess_type(safe_name)[0] or 'application/octet-stream'
    return FileResponse(target_path, media_type=media_type, filename=safe_name)


@app.get('/v1/local-assets/local-secrets')
def list_local_secrets():
    names = sorted(local_secret_records.keys(), key=lambda x: x.lower())
    return {
        'count': len(names),
        'items': [{'name': n} for n in names],
    }


@app.post('/v1/local-assets/local-secrets')
async def upsert_local_secret(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Payload inválido')
    name = str(payload.get('name') or payload.get('key') or '').strip()
    value = str(payload.get('value') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail='Nombre de secreto requerido')
    if not value:
        raise HTTPException(status_code=400, detail='Valor de secreto requerido')

    local_secret_records[name] = value
    _save_local_secret_records()
    return {'ok': True, 'name': name}


@app.delete('/v1/local-assets/local-secrets/{name}')
def delete_local_secret(name: str):
    key = str(name or '').strip()
    if not key:
        raise HTTPException(status_code=400, detail='Nombre de secreto requerido')
    existed = key in local_secret_records
    if existed:
        del local_secret_records[key]
        _save_local_secret_records()
    return {'ok': True, 'deleted': bool(existed), 'name': key}


@app.get('/v1/local-assets/asset-bundles')
def list_asset_bundles():
    return {
        'count': len(asset_bundle_records),
        'items': list(reversed(asset_bundle_records)),
    }


def _policy_scalar(value) -> str:
    if value is None:
        return ''
    if isinstance(value, list):
        for item in value:
            scalar = _policy_scalar(item)
            if scalar:
                return scalar
        return ''
    if not isinstance(value, dict):
        return str(value).strip()
    for key in (
        '@value',
        'value',
        'rightOperand',
        'odrl:rightOperand',
        'operandRight',
        'edc:operandRight',
        'leftOperand',
        'odrl:leftOperand',
        'operandLeft',
        'edc:operandLeft',
        '@id',
        'id',
    ):
        scalar = _policy_scalar(value.get(key))
        if scalar:
            return scalar
    return ''


def _policy_access_level(policy: dict) -> str:
    if not isinstance(policy, dict):
        return ''
    permissions = policy.get('permission') or policy.get('odrl:permission') or []
    if not isinstance(permissions, list):
        permissions = [permissions]
    constraints_raw = policy.get('constraint') or policy.get('odrl:constraint') or []
    constraints = list(constraints_raw) if isinstance(constraints_raw, list) else [constraints_raw]
    for permission in permissions:
        if not isinstance(permission, dict):
            continue
        permission_constraints = permission.get('constraint') or permission.get('odrl:constraint') or []
        if not isinstance(permission_constraints, list):
            permission_constraints = [permission_constraints]
        constraints.extend(permission_constraints)
    for constraint in constraints:
        if not isinstance(constraint, dict):
            continue
        left = _policy_scalar(
            constraint.get('leftOperand')
            or constraint.get('odrl:leftOperand')
            or constraint.get('operandLeft')
            or constraint.get('edc:operandLeft')
        ).lower()
        if left in {
            'dct:accessrights',
            'accessrights',
            'http://purl.org/dc/terms/accessrights',
            'https://purl.org/dc/terms/accessrights',
        }:
            return _policy_scalar(
                constraint.get('rightOperand')
                or constraint.get('odrl:rightOperand')
                or constraint.get('operandRight')
                or constraint.get('edc:operandRight')
            )
    return str(policy.get('dct:accessRights') or policy.get('accessRights') or '').strip()


def _combine_visibility(*values) -> str:
    """Combine visibility levels: if any is private, return private; otherwise public."""
    normalized = []
    for value in values:
        if not value:
            continue
        v_str = str(value).strip().lower()
        if not v_str:
            continue
        # Extract last token from URIs like http://purl.org/dc/terms/accessRights
        token = v_str.split('/')[-1] if '/' in v_str else v_str.split('#')[-1] if '#' in v_str else v_str
        if token in ('privado', 'private', 'restricted', 'partners', 'internal'):
            return 'private'
        elif token in ('publico', 'public'):
            normalized.append('public')
    return 'public' if normalized else ''


def _public_asset_bundle_metadata(row: dict) -> dict:
    asset_body = row.get('assetBody') if isinstance(row.get('assetBody'), dict) else {}
    props = asset_body.get('properties') or asset_body.get('edc:properties') or {}
    if not isinstance(props, dict):
        props = {}
    policy_body = row.get('policyBody') if isinstance(row.get('policyBody'), dict) else {}
    policy = policy_body.get('policy') or policy_body.get('edc:policy') or {}
    private_props = policy_body.get('privateProperties') if isinstance(policy_body.get('privateProperties'), dict) else {}
    policy_meta = row.get('policyMeta') if isinstance(row.get('policyMeta'), dict) else {}
    contract_body = row.get('contractBody') if isinstance(row.get('contractBody'), dict) else {}

    # Combine visibility from multiple sources: if any is private, result is private
    visibility = _combine_visibility(
        policy_meta.get('accessLevel', ''),
        private_props.get('eitel:accessLevel', ''),
        row.get('visibility'),
        props.get('eitel:visibility'),
        props.get('dct:accessRights'),
        _policy_access_level(policy),
        policy.get('dct:accessRights') if isinstance(policy, dict) else ''
    )
    
    return {
        'assetId': str(row.get('assetId') or asset_body.get('@id') or asset_body.get('id') or '').strip(),
        'assetName': str(row.get('assetName') or props.get('name') or props.get('title') or props.get('dct:title') or '').strip(),
        'description': str(props.get('description') or props.get('eitel:description') or props.get('dct:description') or '').strip(),
        'imageUrl': str(props.get('image') or props.get('eitel:image') or props.get('schema:image') or '').strip(),
        'keywords': str(props.get('keywords') or props.get('eitel:keywords') or props.get('dcat:keyword') or '').strip(),
        'visibility': str(visibility or 'public').strip(),
        'ownerEmail': str(row.get('ownerEmail') or props.get('eitel:ownerEmail') or '').strip(),
        'ownerName': str(row.get('ownerName') or props.get('eitel:ownerName') or '').strip(),
        'policyId': str(row.get('policyId') or policy_body.get('@id') or '').strip(),
        'contractDefId': str(row.get('contractDefId') or contract_body.get('@id') or '').strip(),
        'updatedAt': str(row.get('updatedAt') or '').strip(),
    }


@app.get('/v1/local-assets/asset-bundles/public')
def list_public_asset_bundle_metadata():
    items = [
        item
        for item in (_public_asset_bundle_metadata(row) for row in reversed(asset_bundle_records) if isinstance(row, dict))
        if item.get('assetId')
    ]
    return {'count': len(items), 'items': items}


@app.post('/v1/local-assets/asset-bundles')
async def upsert_asset_bundle(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Payload inválido')

    asset_id = str(payload.get('assetId') or '').strip()
    if not asset_id:
        raise HTTPException(status_code=400, detail='assetId es obligatorio')

    now_iso = datetime.now(UTC).isoformat()
    row = {
        **payload,
        'assetId': asset_id,
        'updatedAt': now_iso,
    }
    idx = next((i for i, item in enumerate(asset_bundle_records) if str(item.get('assetId') or '') == asset_id), -1)
    if idx >= 0:
        merged = dict(asset_bundle_records[idx])
        merged.update(row)
        asset_bundle_records[idx] = merged
    else:
        asset_bundle_records.append(row)
        if len(asset_bundle_records) > MAX_ASSET_BUNDLE_RECORDS:
            del asset_bundle_records[: len(asset_bundle_records) - MAX_ASSET_BUNDLE_RECORDS]
    _save_asset_bundle_records()
    return {'ok': True, 'assetId': asset_id, 'updatedAt': now_iso}


@app.delete('/v1/local-assets/asset-bundles/{asset_id}')
def delete_asset_bundle(asset_id: str):
    target = str(asset_id or '').strip()
    if not target:
        raise HTTPException(status_code=400, detail='assetId es obligatorio')
    before = len(asset_bundle_records)
    asset_bundle_records[:] = [row for row in asset_bundle_records if str(row.get('assetId') or '') != target]
    _save_asset_bundle_records()
    return {'ok': True, 'deleted': len(asset_bundle_records) < before, 'assetId': target}


@app.get('/v1/local-assets/access-requests')
def list_access_requests(
    assetId: str | None = None,
    status: str | None = None,
    ownerEmail: str | None = None,
    requesterEmail: str | None = None,
    requesterConnectorId: str | None = None,
):
    items = list(reversed(access_request_records))

    if assetId:
        target_asset_id = str(assetId).strip()
        items = [row for row in items if str(row.get('assetId') or '').strip() == target_asset_id]

    if status:
        target_status = str(status).strip().lower()
        items = [row for row in items if str(row.get('status') or '').strip().lower() == target_status]

    if ownerEmail:
        target_owner_email = str(ownerEmail).strip().lower()
        items = [row for row in items if str(row.get('ownerEmail') or '').strip().lower() == target_owner_email]

    if requesterEmail:
        target_requester_email = str(requesterEmail).strip().lower()
        items = [row for row in items if str(row.get('requesterEmail') or '').strip().lower() == target_requester_email]

    if requesterConnectorId:
        target_requester_connector_id = str(requesterConnectorId).strip().lower()
        items = [
            row
            for row in items
            if str(row.get('requesterConnectorId') or '').strip().lower() == target_requester_connector_id
        ]

    return {'count': len(items), 'items': items}


@app.post('/v1/local-assets/access-requests')
async def create_access_request(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail='Payload invalido')

    asset_id = str(payload.get('assetId') or '').strip()
    requester_name = str(payload.get('requesterName') or '').strip()
    requester_email = str(payload.get('requesterEmail') or '').strip()
    requester_org = str(payload.get('requesterOrg') or '').strip()
    requester_connector_id = str(payload.get('requesterConnectorId') or '').strip()
    purpose = str(payload.get('purpose') or '').strip()
    owner_email = str(payload.get('ownerEmail') or '').strip()

    if not asset_id:
        raise HTTPException(status_code=400, detail='assetId es obligatorio')
    if not requester_name:
        raise HTTPException(status_code=400, detail='requesterName es obligatorio')
    if not requester_email:
        raise HTTPException(status_code=400, detail='requesterEmail es obligatorio')
    if not purpose:
        raise HTTPException(status_code=400, detail='purpose es obligatorio')

    requester_key = requester_email.lower()
    requester_connector_key = requester_connector_id.lower()
    existing_active = next(
        (
            row
            for row in reversed(access_request_records)
            if str(row.get('assetId') or '').strip() == asset_id
            and (
                (
                    requester_connector_key
                    and str(row.get('requesterConnectorId') or '').strip().lower() == requester_connector_key
                )
                or (
                    not requester_connector_key
                    and str(row.get('requesterEmail') or '').strip().lower() == requester_key
                )
            )
            and str(row.get('status') or '').strip().lower() in {'pending', 'approved'}
        ),
        None,
    )
    if existing_active:
        return {
            'ok': True,
            'requestId': existing_active.get('requestId', ''),
            'status': existing_active.get('status', ''),
            'item': existing_active,
            'duplicate': True,
        }

    now_iso = datetime.now(UTC).isoformat()
    row = {
        'requestId': uuid4().hex,
        'assetId': asset_id,
        'assetTitle': str(payload.get('assetTitle') or '').strip(),
        'ownerConnectorId': str(payload.get('ownerConnectorId') or '').strip(),
        'ownerEmail': owner_email,
        'status': 'pending',
        'requesterConnectorId': requester_connector_id,
        'requesterName': requester_name,
        'requesterEmail': requester_email,
        'requesterOrg': requester_org,
        'purpose': purpose,
        'requestedDuration': str(payload.get('requestedDuration') or '').strip(),
        'message': str(payload.get('message') or '').strip(),
        'createdAt': now_iso,
        'updatedAt': now_iso,
        'decisionAt': '',
        'decisionBy': '',
        'decisionReason': '',
    }

    access_request_records.append(row)
    if len(access_request_records) > MAX_ACCESS_REQUEST_RECORDS:
        del access_request_records[: len(access_request_records) - MAX_ACCESS_REQUEST_RECORDS]
    _save_access_request_records()
    email_notification = _send_access_request_email(row)

    return {'ok': True, 'requestId': row['requestId'], 'status': row['status'], 'item': row, 'emailNotification': email_notification}


@app.post('/v1/local-assets/access-requests/{request_id}/approve')
async def approve_access_request(request_id: str, request: Request):
    target_request_id = str(request_id or '').strip()
    if not target_request_id:
        raise HTTPException(status_code=400, detail='requestId es obligatorio')

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    idx = next(
        (i for i, item in enumerate(access_request_records) if str(item.get('requestId') or '').strip() == target_request_id),
        -1,
    )
    if idx < 0:
        raise HTTPException(status_code=404, detail='Solicitud no encontrada')

    now_iso = datetime.now(UTC).isoformat()
    current = access_request_records[idx]
    updated = {
        **current,
        'status': 'approved',
        'updatedAt': now_iso,
        'decisionAt': now_iso,
        'decisionBy': str(payload.get('decisionBy') or '').strip(),
        'decisionReason': str(payload.get('decisionReason') or '').strip(),
    }
    access_request_records[idx] = updated
    _save_access_request_records()
    email_notification = _send_decision_email(updated, 'approved')

    return {'ok': True, 'requestId': target_request_id, 'status': updated['status'], 'item': updated, 'emailNotification': email_notification}


@app.post('/v1/local-assets/access-requests/{request_id}/reject')
async def reject_access_request(request_id: str, request: Request):
    target_request_id = str(request_id or '').strip()
    if not target_request_id:
        raise HTTPException(status_code=400, detail='requestId es obligatorio')

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    idx = next(
        (i for i, item in enumerate(access_request_records) if str(item.get('requestId') or '').strip() == target_request_id),
        -1,
    )
    if idx < 0:
        raise HTTPException(status_code=404, detail='Solicitud no encontrada')

    now_iso = datetime.now(UTC).isoformat()
    current = access_request_records[idx]
    updated = {
        **current,
        'status': 'rejected',
        'updatedAt': now_iso,
        'decisionAt': now_iso,
        'decisionBy': str(payload.get('decisionBy') or '').strip(),
        'decisionReason': str(payload.get('decisionReason') or '').strip(),
    }
    access_request_records[idx] = updated
    _save_access_request_records()
    email_notification = _send_decision_email(updated, 'rejected')

    return {'ok': True, 'requestId': target_request_id, 'status': updated['status'], 'item': updated, 'emailNotification': email_notification}


@app.post('/v1/local-assets/access-requests/{request_id}/withdraw')
async def withdraw_access_request(request_id: str, request: Request):
    target_request_id = str(request_id or '').strip()
    if not target_request_id:
        raise HTTPException(status_code=400, detail='requestId es obligatorio')

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    idx = next(
        (i for i, item in enumerate(access_request_records) if str(item.get('requestId') or '').strip() == target_request_id),
        -1,
    )
    if idx < 0:
        raise HTTPException(status_code=404, detail='Solicitud no encontrada')

    now_iso = datetime.now(UTC).isoformat()
    current = access_request_records[idx]
    updated = {
        **current,
        'status': 'withdrawn',
        'updatedAt': now_iso,
        'decisionAt': now_iso,
        'decisionBy': str(payload.get('decisionBy') or '').strip(),
        'decisionReason': str(payload.get('decisionReason') or '').strip(),
    }
    access_request_records[idx] = updated
    _save_access_request_records()

    return {'ok': True, 'requestId': target_request_id, 'status': updated['status'], 'item': updated}


@app.post('/v1/local-assets/access-requests/{request_id}/revoke')
async def revoke_access_request(request_id: str, request: Request):
    target_request_id = str(request_id or '').strip()
    if not target_request_id:
        raise HTTPException(status_code=400, detail='requestId es obligatorio')

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    idx = next(
        (i for i, item in enumerate(access_request_records) if str(item.get('requestId') or '').strip() == target_request_id),
        -1,
    )
    if idx < 0:
        raise HTTPException(status_code=404, detail='Solicitud no encontrada')

    now_iso = datetime.now(UTC).isoformat()
    current = access_request_records[idx]
    updated = {
        **current,
        'status': 'revoked',
        'updatedAt': now_iso,
        'decisionAt': now_iso,
        'decisionBy': str(payload.get('decisionBy') or '').strip(),
        'decisionReason': str(payload.get('decisionReason') or '').strip(),
    }
    access_request_records[idx] = updated
    _save_access_request_records()

    return {'ok': True, 'requestId': target_request_id, 'status': updated['status'], 'item': updated}


@app.get('/v1/config')
def get_config():
    return {
        'base_domain': settings.base_domain,
        'path_prefix_template': settings.path_prefix_template,
        'edc_connector_source': settings.edc_connector_source,
        'edc_connector_image': settings.edc_connector_image,
        'edc_connector_git_url': settings.edc_connector_git_url,
        'edc_connector_git_ref': settings.edc_connector_git_ref,
        'edc_connector_git_dockerfile': settings.edc_connector_git_dockerfile,
        'edc_ui_image': settings.edc_ui_image,
    }


@app.post('/v1/tenants')
def create_tenant(payload: TenantCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(TenantModel).where(TenantModel.tenant == payload.tenant))
    if existing:
        raise HTTPException(status_code=409, detail='Tenant already exists')

    tenant = TenantModel(
        tenant=payload.tenant,
        display_name=payload.display_name,
        created_at=datetime.now(UTC),
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    prefix = _prefix_for(payload.tenant)
    return {
        'id': tenant.id,
        'tenant': tenant.tenant,
        'display_name': tenant.display_name,
        'created_at': tenant.created_at.isoformat(),
        'public_urls': {
            'ui': f'https://{settings.base_domain}{prefix}/',
            'dsp': f'https://{settings.base_domain}{prefix}/api/v1/dsp',
        },
    }


@app.get('/v1/tenants')
def list_tenants(db: Session = Depends(get_db)):
    rows = db.scalars(select(TenantModel).order_by(TenantModel.created_at.desc())).all()
    return {
        'items': [
            {
                'id': t.id,
                'tenant': t.tenant,
                'display_name': t.display_name,
                'created_at': t.created_at.isoformat(),
            }
            for t in rows
        ]
    }


@app.post('/v1/tenants/{tenant}/connector-plan')
def connector_plan(tenant: str, payload: ConnectorPlanRequest, db: Session = Depends(get_db)):
    tenant_row = db.scalar(select(TenantModel).where(TenantModel.tenant == tenant))
    if not tenant_row:
        raise HTTPException(status_code=404, detail='Tenant not found')

    _validate_connector_source_settings()

    participant_id = _participant_id(tenant, payload.participant_id)
    api_key = payload.api_key or settings.default_edc_api_key
    db_password = payload.db_password or settings.default_db_password

    compose = _compose_for_tenant(tenant, participant_id, api_key, db_password)
    compose_yaml = yaml.safe_dump(compose, sort_keys=False)

    prefix = _prefix_for(tenant)
    ui_url = f'https://{settings.base_domain}{prefix}/'
    dsp_url = f'https://{settings.base_domain}{prefix}/api/v1/dsp'

    plan = PlanModel(
        tenant_id=tenant_row.id,
        created_at=datetime.now(UTC),
        participant_id=participant_id,
        compose_yaml=compose_yaml,
        ui_url=ui_url,
        dsp_url=dsp_url,
        status='planned',
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    lb_rules = {
        'path_prefix': prefix,
        'required_paths': [
            f'{prefix}/',
            f'{prefix}/api/management',
            f'{prefix}/api/v1/dsp',
            f'{prefix}/_next/',
            f'{prefix}/health',
        ],
    }

    return {
        'plan_id': plan.id,
        'tenant': tenant,
        'participant_id': participant_id,
        'compose_yaml': compose_yaml,
        'public_urls': {'ui': ui_url, 'dsp': dsp_url},
        'load_balancer_rules': lb_rules,
    }


@app.get('/v1/plans')
def list_plans(db: Session = Depends(get_db)):
    rows = db.scalars(select(PlanModel).order_by(PlanModel.created_at.desc())).all()
    return {
        'items': [
            {
                'id': p.id,
                'tenant_id': p.tenant_id,
                'participant_id': p.participant_id,
                'created_at': p.created_at.isoformat(),
                'ui_url': p.ui_url,
                'dsp_url': p.dsp_url,
                'status': p.status,
            }
            for p in rows
        ]
    }


@app.post('/v1/plans/{plan_id}/export-compose')
def export_compose(plan_id: int, db: Session = Depends(get_db)):
    plan = db.scalar(select(PlanModel).where(PlanModel.id == plan_id))
    if not plan:
        raise HTTPException(status_code=404, detail='Plan not found')

    tenant = db.scalar(select(TenantModel).where(TenantModel.id == plan.tenant_id))
    if not tenant:
        raise HTTPException(status_code=404, detail='Tenant not found for plan')

    target_dir = Path(settings.generated_output_dir) / tenant.tenant
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / 'docker-compose.generated.yaml'
    target_file.write_text(plan.compose_yaml, encoding='utf-8')

    plan.status = 'exported'
    db.commit()

    return {
        'plan_id': plan.id,
        'tenant': tenant.tenant,
        'file_path': str(target_file),
        'status': plan.status,
    }
