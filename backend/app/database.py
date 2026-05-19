import os
import ssl
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
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
    pool_pre_ping=True,
    pool_recycle=300,   # recycle connections every 5 min, well within Neon's idle timeout
)

# Session maker for FastAPI dependency
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session
