from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
from uuid import uuid4
import json

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse

app = FastAPI(title="EITEL Download Sink", version="0.1.0")

DATA_DIR = Path("/app/data")
INDEX_PATH = DATA_DIR / "index.json"
MAX_RECORDS = 500


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

    record_id = uuid4().hex
    content_disposition = request.headers.get("content-disposition", "")
    filename = _extract_filename(content_disposition)
    file_path = DATA_DIR / f"{record_id}-{filename}"
    file_path.write_bytes(payload)

    record = {
        "id": record_id,
        "received_at": datetime.now(UTC).isoformat(),
        "contractId": contractId,
        "assetId": assetId,
        "transferId": transferId,
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
