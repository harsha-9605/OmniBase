import os
import ssl
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import event, text
from contextvars import ContextVar
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get the database URL
DATABASE_URL = os.getenv("DATABASE_URL", "")

# ── Normalise the URL for asyncpg ─────────────────────────────────────────────
# asyncpg requires the postgresql+asyncpg:// scheme
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Strip SSL / channel_binding query params from the URL — asyncpg doesn't
# accept them as URL params. We pass SSL via connect_args below instead.
parsed = urlparse(DATABASE_URL)
query_params = parse_qs(parsed.query)
needs_ssl = "sslmode" in query_params or "ssl" in query_params

# Remove the params asyncpg doesn't understand
for key in ("sslmode", "ssl", "channel_binding"):
    query_params.pop(key, None)

clean_query = urlencode({k: v[0] for k, v in query_params.items()})
DATABASE_URL = urlunparse(parsed._replace(query=clean_query))

# Build SSL context for Neon (requires TLS, but Neon uses self-signed certs
# so we disable hostname verification while still encrypting the transport)
connect_args = {}
if needs_ssl:
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    connect_args["ssl"] = ssl_ctx

# Create the async engine with pool_pre_ping so dead connections (Neon closes
# idle ones after a timeout) are detected and replaced before being used.
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=300,   # recycle connections every 5 min, well within Neon's idle timeout
)

# ContextVar to store the current tenant_id and account_id for the request scope
tenant_context: ContextVar[Optional[int]] = ContextVar("tenant_context", default=None)
account_context: ContextVar[Optional[int]] = ContextVar("account_context", default=None)

@event.listens_for(engine.sync_engine, "begin")
def set_tenant_session_variable(conn):
    """Propagate the tenant_context and account_context values into PostgreSQL transaction-local setting."""
    t_id = tenant_context.get()
    a_id = account_context.get()
    t_val = str(t_id) if t_id is not None else ""
    a_val = str(a_id) if a_id is not None else ""
    # Use set_config to avoid SQL injection risks with utility statements
    conn.execute(
        text("SELECT set_config('app.current_tenant_id', :t_val, true), set_config('app.current_account_id', :a_val, true)"),
        {"t_val": t_val, "a_val": a_val}
    )



# Session maker for FastAPI dependency
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session

