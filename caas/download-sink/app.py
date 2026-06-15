from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
from uuid import uuid4
import hmac
import ipaddress
import json
import os
import time
import urllib.parse
import urllib.request

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="EITEL Download Sink", version="0.1.0")

DATA_DIR = Path("/app/data")
INDEX_PATH = DATA_DIR / "index.json"
MAX_RECORDS = 500
ARCGIS_AUTH_CACHE_TTL_SECONDS = 180
arcgis_token_auth_cache: dict[str, tuple[float, bool]] = {}


def _is_truthy(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _expected_auth_token() -> str:
    return str(
        os.getenv("DOWNLOAD_SINK_AUTH_TOKEN")
        or os.getenv("CAAS_LOCAL_ASSETS_AUTH_TOKEN")
        or ""
    ).strip()


def _extract_auth_value(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parts = raw.split(None, 1)
    if len(parts) == 2 and parts[0].lower() in {"bearer", "apikey", "api-key"}:
        return parts[1].strip()
    return raw


def _extract_arcgis_token(request: Request) -> str:
    explicit = str(request.headers.get("x-arcgis-token", "") or "").strip()
    if explicit:
        return explicit
    auth = str(request.headers.get("authorization", "") or "").strip()
    parts = auth.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return ""


def _is_private_client_host(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(str(host or "").strip())
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _is_internal_download_sink_host(host: str) -> bool:
    normalized = str(host or "").strip().lower()
    return (
        "download-sink" in normalized
        or normalized.startswith("localhost")
        or normalized.startswith("127.")
        or normalized.startswith("[::1]")
        or normalized.endswith(":8082")
    )


def _is_internal_unproxied_request(request: Request) -> bool:
    if not _is_truthy(os.getenv("DOWNLOAD_SINK_ALLOW_INTERNAL_UNAUTHENTICATED", "true")):
        return False
    if request.headers.get("x-forwarded-for") or request.headers.get("x-forwarded-prefix"):
        return False
    return _is_private_client_host(request.client.host if request.client else "") and _is_internal_download_sink_host(request.headers.get("host", ""))


def _arcgis_auth_enabled() -> bool:
    return _is_truthy(os.getenv("DOWNLOAD_SINK_ARCGIS_AUTH_ENABLED") or os.getenv("ARCGIS_AUTH_ENABLED") or "")


def _arcgis_portal_base_url() -> str:
    raw = str(os.getenv("DOWNLOAD_SINK_ARCGIS_PORTAL_URL") or os.getenv("ARCGIS_PORTAL_URL") or "").strip()
    return raw.rstrip("/").replace("/home/index.html", "").replace("/home", "")


def _arcgis_required_org_id() -> str:
    return str(os.getenv("DOWNLOAD_SINK_ARCGIS_REQUIRED_ORG_ID") or os.getenv("ARCGIS_REQUIRED_ORG_ID") or "").strip()


def _arcgis_required_group_id() -> str:
    return str(os.getenv("DOWNLOAD_SINK_ARCGIS_REQUIRED_GROUP_ID") or os.getenv("ARCGIS_REQUIRED_GROUP_ID") or "").strip()


def _fetch_arcgis_json(path: str, token: str) -> dict:
    portal = _arcgis_portal_base_url()
    if not portal:
        return {}
    query = urllib.parse.urlencode({"f": "json", "token": token})
    url = f'{portal}/sharing/rest/{path.lstrip("/")}?{query}'
    timeout = float(os.getenv("DOWNLOAD_SINK_ARCGIS_VALIDATION_TIMEOUT", "6") or "6")
    with urllib.request.urlopen(url, timeout=timeout) as response:
        raw = response.read()
    parsed = json.loads(raw.decode("utf-8", errors="replace"))
    return parsed if isinstance(parsed, dict) else {}


def _arcgis_user_in_required_group(username: str, token: str) -> bool:
    group_id = _arcgis_required_group_id()
    if not group_id:
        return True

    try:
        group = _fetch_arcgis_json(f"community/groups/{urllib.parse.quote(group_id)}/userList", token)
        members = {
            *[str(item or "") for item in group.get("users") or []],
            *[str(item or "") for item in group.get("admins") or []],
        }
        if group.get("owner"):
            members.add(str(group.get("owner")))
        if username in members:
            return True
    except Exception:
        pass

    try:
        user = _fetch_arcgis_json(f"community/users/{urllib.parse.quote(username)}", token)
        groups = user.get("groups") if isinstance(user.get("groups"), list) else []
        return any(str(group.get("id") or "") == group_id for group in groups if isinstance(group, dict))
    except Exception:
        return False


def _is_arcgis_token_authorized(token: str) -> bool:
    token = str(token or "").strip()
    if not _arcgis_auth_enabled() or not token:
        return False

    now = time.time()
    cached = arcgis_token_auth_cache.get(token)
    if cached and cached[0] > now:
        return cached[1]

    authorized = False
    try:
        self_info = _fetch_arcgis_json("community/self", token)
        if not self_info.get("error"):
            user_info = self_info.get("user") if isinstance(self_info.get("user"), dict) else {}
            username = str(self_info.get("username") or user_info.get("username") or "").strip()
            org_id = str(self_info.get("orgId") or user_info.get("orgId") or "").strip()
            required_org = _arcgis_required_org_id()
            authorized = bool(username) and (not required_org or org_id == required_org) and _arcgis_user_in_required_group(username, token)
    except Exception:
        authorized = False

    arcgis_token_auth_cache[token] = (now + ARCGIS_AUTH_CACHE_TTL_SECONDS, authorized)
    if len(arcgis_token_auth_cache) > 200:
        for cached_token, (expires_at, _) in list(arcgis_token_auth_cache.items()):
            if expires_at <= now:
                arcgis_token_auth_cache.pop(cached_token, None)
    return authorized


def _is_authorized(request: Request) -> bool:
    expected = _expected_auth_token()
    if _is_internal_unproxied_request(request):
        return True
    if expected:
        candidates = [
            request.headers.get("x-local-assets-token", ""),
            request.headers.get("x-api-key", ""),
            _extract_auth_value(request.headers.get("authorization", "")),
        ]
        if any(token and hmac.compare_digest(str(token).strip(), expected) for token in candidates):
            return True
    return _is_arcgis_token_authorized(_extract_arcgis_token(request))


@app.middleware("http")
async def require_download_read_auth(request: Request, call_next):
    path = request.url.path or ""
    protected = path == "/records" or path.startswith("/files/")
    if request.method.upper() == "OPTIONS" or not protected:
        return await call_next(request)
    if _is_authorized(request):
        return await call_next(request)
    if not _expected_auth_token() and not _arcgis_auth_enabled():
        return JSONResponse(status_code=503, content={"detail": "download-sink auth token is not configured"})
    return JSONResponse(status_code=401, content={"detail": "download-sink authentication required"})


def _safe_name(name: str) -> str:
    cleaned = "".join(ch for ch in str(name or "download.bin") if ch.isalnum() or ch in ("-", "_", "."))
    return cleaned or "download.bin"


def _load_records() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    try:
        parsed = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _save_records(records: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(records[-MAX_RECORDS:], ensure_ascii=True, indent=2), encoding="utf-8")


def _extract_filename(content_disposition: str) -> str:
    raw = str(content_disposition or "")
    if "filename*=" in raw:
        try:
            value = raw.split("filename*=", 1)[1].split(";", 1)[0].strip().strip('"')
            if "''" in value:
                value = value.split("''", 1)[1]
            return _safe_name(value)
        except Exception:
            pass
    if "filename=" in raw:
        try:
            value = raw.split("filename=", 1)[1].split(";", 1)[0].strip().strip('"')
            return _safe_name(value)
        except Exception:
            pass
    return "download.bin"


@app.on_event("startup")
def startup() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_PATH.exists():
        _save_records([])


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "download-sink"}


@app.api_route("/ingest", methods=["POST", "PUT"])
async def ingest(request: Request, contractId: str = Query(default=""), assetId: str = Query(default=""), transferId: str = Query(default="")) -> dict:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="Payload vacio")

    contract_id = str(contractId or request.headers.get("x-contract-id", "") or "").strip()
    asset_id = str(assetId or request.headers.get("x-asset-id", "") or "").strip()
    transfer_id = str(transferId or request.headers.get("x-transfer-id", "") or "").strip()

    record_id = uuid4().hex
    content_disposition = request.headers.get("content-disposition", "")
    filename = _extract_filename(content_disposition)
    file_path = DATA_DIR / f"{record_id}-{filename}"
    file_path.write_bytes(payload)

    record = {
        "id": record_id,
        "received_at": datetime.now(UTC).isoformat(),
        "contractId": contract_id,
        "assetId": asset_id,
        "transferId": transfer_id,
        "filename": filename,
        "contentType": request.headers.get("content-type", "application/octet-stream"),
        "bytes": len(payload),
        "downloadPath": f"/files/{record_id}",
    }

    records = _load_records()
    records.append(record)
    _save_records(records)

    return {"ok": True, "record": record, "stored": len(records[-MAX_RECORDS:])}


@app.get("/records")
def records(contractId: str = Query(default="")) -> dict:
    rows = list(reversed(_load_records()))
    if contractId:
        rows = [r for r in rows if str(r.get("contractId") or "").strip() == str(contractId).strip()]
    return {"count": len(rows), "items": rows}


@app.delete("/records")
def clear_records() -> dict:
    rows = _load_records()
    for row in rows:
        record_id = str(row.get("id") or "")
        filename = _safe_name(row.get("filename") or "download.bin")
        fpath = DATA_DIR / f"{record_id}-{filename}"
        if fpath.exists():
            try:
                fpath.unlink()
            except Exception:
                pass
    _save_records([])
    return {"ok": True, "cleared": len(rows)}


@app.get("/files/{record_id}")
def file_download(record_id: str):
    rows = _load_records()
    match = next((r for r in rows if str(r.get("id") or "") == str(record_id)), None)
    if not match:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    filename = _safe_name(match.get("filename") or "download.bin")
    fpath = DATA_DIR / f"{record_id}-{filename}"
    if not fpath.exists() or not fpath.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(path=fpath, media_type=match.get("contentType") or "application/octet-stream", filename=filename)
