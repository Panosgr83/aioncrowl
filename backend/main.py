#!/usr/bin/env python3
import os, traceback, time, collections
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 30
_rate_buckets = collections.defaultdict(list)

ERROR_MESSAGES = {
    400: "Παρακαλώ ελέγξτε τα στοιχεία που στείλατε και δοκιμάστε ξανά.",
    401: "Δεν εξουσιοδοτημένο αίτημα — ελέγξτε το API key σας.",
    403: "Δεν έχετε πρόσβαση σε αυτόν τον πόρο.",
    404: "Δεν βρέθηκε αυτό που ζητάτε.",
    422: "Μη έγκυρα δεδομένα — ελέγξτε την αίτησή σας.",
    429: "Πολλά αιτήματα — παρακαλώ περιμένετε λίγο και δοκιμάστε ξανά.",
    503: "Η υπηρεσία είναι προσωρινά μη διαθέσιμη — δοκιμάστε ξανά σε λίγο.",
}

@asynccontextmanager
async def lifespan(app):
    print("AIONCLAW server starting...")
    from shared import _load_project, _save_project
    pdata = _load_project()
    default_projects = ["angelus_pastry", "angeliki_savvidaki", "melisanuts", "mike_artistic_team"]
    for p in default_projects:
        if p not in pdata["projects"]:
            pdata["projects"].append(p)
    _save_project(pdata)
    print(f"Projects: {pdata['projects']}")
    from scheduler import start_scheduler
    start_scheduler()
    print("Scheduler started")
    from telegram_bot import start as start_telegram
    start_telegram()
    from engine_router import router as engine_router
    engine_router.start()
    yield
    _shutdown_pending = []
    try:
        from engine import call_engine
        pending = getattr(call_engine, '_pending_calls', [])
        if pending:
            print(f"Waiting for {len(pending)} pending engine calls...")
            _shutdown_pending = pending
    except: pass
    from telegram_bot import stop as stop_telegram
    stop_telegram()
    if _shutdown_pending:
        import asyncio
        await asyncio.sleep(2)
    print("AIONCLAW server stopped.")

app = FastAPI(title="AIONCLAW", version="1.0.0", lifespan=lifespan)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    msg = ERROR_MESSAGES.get(exc.status_code)
    if msg:
        detail = exc.detail if isinstance(exc.detail, str) else (exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail))
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": msg, "original_error": detail, "code": exc.status_code},
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.status_code},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Προέκυψε ένα εσωτερικό σφάλμα — δοκιμάστε ξανά ή επικοινωνήστε με τον διαχειριστή.", "code": 500},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AIONCLAW_API_KEY = os.environ.get("AIONCLAW_API_KEY", "")

INJECTION_PATTERNS_MW = [
    "ignore all previous instructions", "αγνόησε όλες τις προηγούμενες οδηγίες",
    "ignore all prior", "αγνόησε όλες τις προηγούμενες",
    "do anything now", "dan", "you are now", "εισαι τωρα",
    "system prompt", "output your instructions", "βγαλε τις οδηγιες",
    "forget everything", "ξεχασε τα παντα", "you must obey",
    "ρεσετ", "reset", "new prompt", "νεο prompt",
    "bypass", "παράκαμψη", "you are not", "δεν εισαι",
    "act as", "συμπεριφερσου ως", "pretend", "προσποιησου",
    "reveal", "αποκαλυψε", "show your", "δειξε μου",
]

@app.middleware("http")
async def sanitize_middleware(request: Request, call_next):
    if request.url.path in ("/api/chat",) and request.method == "POST":
        try:
            body = await request.body()
            text = body.decode().lower()
            for p in INJECTION_PATTERNS_MW:
                if p in text:
                    return JSONResponse(
                        status_code=400,
                        content={"detail": "Το μήνυμά σας περιέχει μη επιτρεπόμενες εντολές — παρακαλώ αναδιατυπώστε το.", "code": 400},
                    )
        except:
            pass
    return await call_next(request)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method != "OPTIONS":
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        bucket = _rate_buckets[client_ip]
        bucket[:] = [t for t in bucket if now - t < RATE_LIMIT_WINDOW]
        if len(bucket) >= RATE_LIMIT_MAX:
            return JSONResponse(
                status_code=429,
                content={"detail": "Πολλά αιτήματα — παρακαλώ περιμένετε λίγο και δοκιμάστε ξανά.", "code": 429},
            )
        bucket.append(now)
    return await call_next(request)

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if AIONCLAW_API_KEY and request.url.path.startswith("/api/"):
        client_key = request.headers.get("x-api-key", "")
        if client_key != AIONCLAW_API_KEY:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)

from routers.chat import router as chat_router
from routers.agents import router as agents_router
from routers.sessions import router as sessions_router
from routers.files import router as files_router
from routers.projects import router as projects_router
from routers.knowledge import router as knowledge_router
from routers.scheduler_routes import router as scheduler_router
from routers.admin import router as admin_router

app.include_router(chat_router)
app.include_router(agents_router)
app.include_router(sessions_router)
app.include_router(files_router)
app.include_router(projects_router)
app.include_router(knowledge_router)
app.include_router(scheduler_router)
app.include_router(admin_router)

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
    print(f"Frontend served from {FRONTEND_DIST}")
else:
    print(f"Frontend dist not found at {FRONTEND_DIST}, run 'npm run build' in frontend/")

if __name__ == "__main__":
    from engine import _load_env as _engine_load_env
    _engine_load_env()
    import socket
    port = int(os.environ.get("PORT", 9789))
    print(f"AIONCLAW backend starting on http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)
