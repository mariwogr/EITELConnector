import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles


APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("EITEL_CATALOG_CONFIG", "/app/config/connectors.yaml"))
TIMEOUT_SECONDS = float(os.getenv("EITEL_CATALOG_TIMEOUT_SECONDS", "8"))
CACHE_SECONDS = float(os.getenv("EITEL_CATALOG_CACHE_SECONDS", "0"))

SAFE_ASSET_FIELDS = {
    "assetId",
    "assetName",
    "description",
    "keywords",
    "visibility",
    "ownerName",
    "ownerEmail",
    "publisherName",
    "publisherEmail",
    "createdBy",
    "policyId",
    "contractDefId",
    "updatedAt",
}

app = FastAPI(title="EITEL Public Catalog", version="1.0.0")
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
app.mount("/catalog/static", StaticFiles(directory=APP_DIR / "static"), name="catalog-static")

_cache: dict[str, Any] = {"timestamp": 0.0, "payload": None}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        return {}
    return data


def _connector_auth_headers(connector: dict[str, Any]) -> dict[str, str]:
    token_envs = [
        str(connector.get("authTokenEnv") or "").strip(),
        str(connector.get("fallbackAuthTokenEnv") or "").strip(),
    ]
    token = ""
    for token_env in token_envs:
        token = os.getenv(token_env, "").strip() if token_env else ""
        if token:
            break
    if not token:
        return {}
    return {
        "x-local-assets-token": token,
        "x-api-key": token,
    }


def _fetch_json(url: str, connector: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    try:
        headers = {
            "Accept": "application/json",
            "User-Agent": "EITEL-Public-Catalog/1.0",
        }
        if connector:
            headers.update(_connector_auth_headers(connector))
        req = urllib.request.Request(
            url,
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            body = resp.read().decode("utf-8")
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            return parsed, None
        return {"items": parsed if isinstance(parsed, list) else []}, None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        return None, str(exc)


def _check_health(url: str, connector: dict[str, Any] | None = None) -> tuple[bool, str | None]:
    if not url:
        return False, "health URL not configured"
    try:
        headers = {"User-Agent": "EITEL-Public-Catalog/1.0"}
        if connector:
            headers.update(_connector_auth_headers(connector))
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return 200 <= int(resp.status) < 400, None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, str(exc)


def _as_keywords(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not value:
        return []
    return [part.strip() for part in str(value).replace(";", ",").split(",") if part.strip()]


def _sanitize_asset(raw: dict[str, Any], connector: dict[str, Any], access_form: str) -> dict[str, Any]:
    safe = {field: raw.get(field, "") for field in SAFE_ASSET_FIELDS}
    safe["keywords"] = _as_keywords(safe.get("keywords"))
    safe["providerId"] = connector.get("id", "")
    safe["providerName"] = connector.get("name", connector.get("id", ""))
    safe["providerOrganization"] = connector.get("organization", "")
    safe["credentialUrl"] = connector.get("credentialUrl", "")
    safe["accessFormUrl"] = connector.get("accessFormUrl") or access_form
    safe["visibility"] = str(safe.get("visibility") or "unknown").lower()
    return safe


def _build_catalog(refresh: bool = False) -> dict[str, Any]:
    now = time.time()
    if (
        not refresh
        and CACHE_SECONDS > 0
        and _cache.get("payload") is not None
        and now - float(_cache.get("timestamp") or 0) < CACHE_SECONDS
    ):
        return _cache["payload"]

    config = _load_config()
    access_form = str(config.get("defaultAccessFormUrl") or "").strip()
    connectors = [item for item in config.get("connectors", []) if isinstance(item, dict) and item.get("enabled", True)]
    assets: list[dict[str, Any]] = []
    connector_status: list[dict[str, Any]] = []

    for connector in connectors:
        catalog_url = str(connector.get("catalogUrl") or "").strip()
        health_url = str(connector.get("healthUrl") or "").strip()
        online, health_error = _check_health(health_url, connector)
        catalog_data, catalog_error = _fetch_json(catalog_url, connector) if catalog_url else (None, "catalog URL not configured")
        raw_items = catalog_data.get("items", []) if isinstance(catalog_data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []

        connector_status.append(
            {
                "id": connector.get("id", ""),
                "name": connector.get("name", connector.get("id", "")),
                "organization": connector.get("organization", ""),
                "online": bool(online),
                "assetCount": len(raw_items),
                "lastChecked": _utc_now(),
                "healthError": health_error,
                "catalogError": catalog_error,
                "credentialUrl": connector.get("credentialUrl", ""),
            }
        )

        for raw in raw_items:
            if isinstance(raw, dict):
                assets.append(_sanitize_asset(raw, connector, access_form))

    payload = {
        "title": config.get("title", "EITEL Public Catalog"),
        "subtitle": config.get("subtitle", ""),
        "generatedAt": _utc_now(),
        "metadataOnly": True,
        "description": "This catalog exposes connector metadata only. It does not proxy data, negotiate contracts, or execute transfers.",
        "defaultAccessFormUrl": access_form,
        "connectors": connector_status,
        "assets": assets,
    }
    _cache.update({"timestamp": now, "payload": payload})
    return payload


def _find_connector(connector_id: str) -> dict[str, Any] | None:
    requested = connector_id.strip().lower()
    config = _load_config()
    connectors = config.get("connectors", [])
    if not isinstance(connectors, list):
        return None
    for connector in connectors:
        if not isinstance(connector, dict):
            continue
        if not connector.get("enabled", True):
            continue
        candidates = {
            str(connector.get("id") or "").strip().lower(),
            str(connector.get("name") or "").strip().lower(),
        }
        if requested in candidates:
            return connector
    return None


def _credential_response(connector_id: str) -> JSONResponse:
    connector = _find_connector(connector_id)
    if not connector:
        return JSONResponse({"error": "Connector not configured"}, status_code=404)
    credential_url = str(connector.get("credentialUrl") or "").strip()
    if not credential_url:
        return JSONResponse({"error": "Credential URL not configured"}, status_code=404)
    data, error = _fetch_json(credential_url, connector)
    if error or data is None:
        return JSONResponse({"error": error or "Credential unavailable"}, status_code=502)
    return JSONResponse(data)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "eitel-public-catalog"}


@app.get("/catalog/health")
def health_prefixed() -> dict[str, Any]:
    return {"ok": True, "service": "eitel-public-catalog"}


@app.get("/api/catalog")
def api_catalog(refresh: bool = Query(False)) -> JSONResponse:
    return JSONResponse(_build_catalog(refresh=refresh))


@app.get("/catalog/api/catalog")
def api_catalog_prefixed(refresh: bool = Query(False)) -> JSONResponse:
    return JSONResponse(_build_catalog(refresh=refresh))


@app.get("/api/credential/{connector_id}")
def api_credential(connector_id: str) -> JSONResponse:
    return _credential_response(connector_id)


@app.get("/catalog/api/credential/{connector_id}")
def api_credential_prefixed(connector_id: str) -> JSONResponse:
    return _credential_response(connector_id)


@app.get("/")
def index() -> RedirectResponse:
    return RedirectResponse(url="/catalog/")


@app.get("/catalog")
def catalog_no_slash() -> RedirectResponse:
    return RedirectResponse(url="/catalog/")


@app.get("/catalog/", response_class=HTMLResponse)
def catalog_index() -> HTMLResponse:
    return HTMLResponse((APP_DIR / "static" / "index.html").read_text(encoding="utf-8"))
