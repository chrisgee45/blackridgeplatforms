import os
import json
import asyncio
import threading
import secrets
import ipaddress
from datetime import datetime, timedelta
from typing import Optional, List
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from models import AuditRequest, LoginRequest
from database import init_db, create_audit, update_audit, get_audit, get_audits
from qa_runner import QAOrchestrator

app = FastAPI(title="BlackRidge QA Audit Portal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

TOKEN_EXPIRY_HOURS = 24
active_tokens: dict[str, dict] = {}
event_queues: dict[int, asyncio.Queue] = {}
event_loop = None


def get_or_create_loop():
    global event_loop
    if event_loop is None or event_loop.is_closed():
        event_loop = asyncio.new_event_loop()
        t = threading.Thread(target=event_loop.run_forever, daemon=True)
        t.start()
    return event_loop


QA_PASSWORD = os.environ.get("QA_PORTAL_PASSWORD") or os.environ.get("ADMIN_PASSWORD")
if not QA_PASSWORD:
    print("WARNING: QA_PORTAL_PASSWORD or ADMIN_PASSWORD must be set. Using fallback for development only.")
    QA_PASSWORD = "blackridge-qa-dev-" + secrets.token_hex(4)
    print(f"Generated dev password: {QA_PASSWORD}")


BLOCKED_CIDRS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def validate_target_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Target URL must use http or https scheme")
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid target URL")
    try:
        import socket
        resolved = socket.getaddrinfo(hostname, None)
        for _, _, _, _, addr in resolved:
            ip = ipaddress.ip_address(addr[0])
            for cidr in BLOCKED_CIDRS:
                if ip in cidr:
                    raise HTTPException(status_code=400, detail="Target URL resolves to a private/internal IP address")
    except HTTPException:
        raise
    except Exception:
        pass


def verify_token(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0] != "Bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization format")
    token = parts[1]
    token_data = active_tokens.get(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if datetime.utcnow() > token_data["expires"]:
        active_tokens.pop(token, None)
        raise HTTPException(status_code=401, detail="Token expired")
    return token_data["user_id"]


def verify_token_from_query(t: Optional[str] = Query(None)):
    if not t:
        raise HTTPException(status_code=401, detail="Token required")
    token_data = active_tokens.get(t)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if datetime.utcnow() > token_data["expires"]:
        active_tokens.pop(t, None)
        raise HTTPException(status_code=401, detail="Token expired")
    return token_data["user_id"]


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    if req.password != QA_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = secrets.token_hex(32)
    user_id = "admin"
    active_tokens[token] = {
        "user_id": user_id,
        "expires": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRY_HOURS)
    }
    return {"token": token, "user_id": user_id}


@app.post("/api/audits/run")
async def run_audit(req: AuditRequest, user_id: str = Depends(verify_token)):
    validate_target_url(req.target_url)

    audit_id = create_audit(user_id, req.project_name, req.target_url, req.auth_token)

    queue = asyncio.Queue()
    event_queues[audit_id] = queue

    loop = get_or_create_loop()

    def progress_callback(event_type, data):
        event = {"type": event_type, **data}
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    def db_callback(aid, updates):
        update_audit(aid, updates)

    orchestrator = QAOrchestrator(
        audit_id=audit_id,
        target_url=req.target_url,
        auth_token=req.auth_token,
        known_endpoints=req.known_endpoints or [],
        db_update_callback=db_callback,
        progress_callback=progress_callback,
    )

    thread = threading.Thread(target=orchestrator.run, daemon=True)
    thread.start()

    return {"audit_id": audit_id}


@app.get("/api/audits/{audit_id}/stream")
async def stream_audit(audit_id: int, user_id: str = Depends(verify_token)):
    queue = event_queues.get(audit_id)
    if not queue:
        audit = get_audit(audit_id)
        if audit and audit["status"] == "completed":
            async def completed_gen():
                yield f"data: {json.dumps({'type': 'complete', 'score': audit['score'], 'grade': audit['grade'], 'audit_id': audit_id})}\n\n"
            return StreamingResponse(completed_gen(), media_type="text/event-stream")
        raise HTTPException(status_code=404, detail="Audit not found or not streaming")

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=120)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in ("complete", "error"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        finally:
            event_queues.pop(audit_id, None)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })


@app.get("/api/audits/{audit_id}")
async def get_audit_detail(audit_id: int, user_id: str = Depends(verify_token)):
    audit = get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    return audit


@app.get("/api/audits")
async def list_audits(limit: int = 50, offset: int = 0, user_id: str = Depends(verify_token)):
    return get_audits(limit, offset)


@app.get("/api/audits/{audit_id}/download/json")
async def download_json(audit_id: int, user_id: str = Depends(verify_token)):
    audit = get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    report = audit.get("report_json", "{}")
    return JSONResponse(
        content=json.loads(report) if report else {},
        headers={"Content-Disposition": f"attachment; filename=qa-report-{audit_id}.json"}
    )


@app.get("/api/audits/{audit_id}/download/markdown")
async def download_markdown(audit_id: int, user_id: str = Depends(verify_token)):
    audit = get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    md = audit.get("report_markdown", "# No report available")
    return Response(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename=qa-report-{audit_id}.md"}
    )


app.mount("/client", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "client")), name="client")


@app.get("/")
async def serve_frontend():
    return FileResponse(os.path.join(os.path.dirname(__file__), "client", "index.html"))
