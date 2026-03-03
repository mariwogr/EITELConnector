from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
from typing import Literal

import yaml
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
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


settings = Settings()
app = FastAPI(title='EITEL Connector CaaS Control Plane', version='0.2.0')

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


class TenantCreate(BaseModel):
    tenant: str = Field(min_length=2, max_length=50, pattern=r'^[a-z0-9-]+$')
    display_name: str = Field(min_length=2, max_length=100)


class ConnectorPlanRequest(BaseModel):
    deployment_mode: Literal['single-host-docker'] = 'single-host-docker'
    participant_id: str | None = None
    api_key: str | None = None
    db_password: str | None = None


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
