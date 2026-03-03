# EITEL Connector as a Service (fase 2)

Implementación **fase 2** para construir un Connector-as-a-Service propio en EITEL.

## Qué incluye esta fase

- `control-plane` con FastAPI + SQLAlchemy (persistencia en SQLite)
- UI web de administración integrada (crear tenants, generar plan, exportar compose)
- Generación de planes y `docker-compose` por tenant
- Reglas de publicación recomendadas para balanceador

## Base tecnológica del conector

Esta implementación está preparada para usar un **runtime propio de EITEL basado en Eclipse Dataspace Connector**.

- Variable clave: `CAAS_EDC_CONNECTOR_IMAGE`
- Valor por defecto: `eitel/eclipse-edc-runtime:latest`

> Nota: la imagen debe ser la vuestra (construida desde Eclipse EDC con vuestra configuración de arranque).

## Estructura

- `control-plane/app/main.py`: API + lógica de planes + UI server
- `control-plane/app/templates/index.html`: UI de administración
- `control-plane/app/static/*`: assets de la UI
- `control-plane/requirements.txt`: dependencias
- `control-plane/.env.example`: configuración
- `docker-compose.caas.yaml`: arranque local del control-plane

## Endpoints principales

- `GET /` UI de administración
- `POST /v1/tenants` crea tenant
- `GET /v1/tenants` lista tenants
- `POST /v1/tenants/{tenant}/connector-plan` genera plan
- `POST /v1/plans/{plan_id}/export-compose` exporta compose a disco
- `GET /v1/plans` lista planes

## Arranque

1. Ir a carpeta `caas`
2. Levantar:
  - `docker compose -f docker-compose.caas.yaml up -d --build`
3. Abrir UI:
  - `http://localhost:18081`

## Sin imagen EDC publicada: build desde GitHub

Configura en `control-plane/.env.example`:

- `CAAS_EDC_CONNECTOR_SOURCE=git`
- `CAAS_EDC_CONNECTOR_GIT_URL=https://github.com/eclipse-edc/Connector.git`
- `CAAS_EDC_CONNECTOR_GIT_REF=main`
- `CAAS_EDC_CONNECTOR_GIT_DOCKERFILE=<ruta-real-al-Dockerfile>`

El `docker-compose.generated.yaml` incluirá `build` para el runtime del conector.

> Importante: el repositorio `eclipse-edc/Connector` es el código fuente base de Eclipse EDC. Para despliegue directo en Docker normalmente necesitas **un runtime propio** (fork o repo wrapper) que incluya un `Dockerfile` de arranque del conector con los módulos y configuración que quieras usar.

## UI propia EITEL

Se incluye una UI mínima en `edc-ui/`.

Construcción local:

- `docker build -t eitel/edc-ui:latest ./edc-ui`

La UI usa variables:

- `NEXT_PUBLIC_MANAGEMENT_API_URL`
- `NEXT_PUBLIC_MANAGEMENT_API_AUTH_KEY`
- `NEXT_PUBLIC_CONNECTOR_NAME`

## Siguiente fase (opcional)

- Provisionado automático de tenants (Docker API / Terraform)
- PostgreSQL para control-plane (en lugar de SQLite)
- IAM/OIDC por organización
- Cuotas, billing y auditoría
