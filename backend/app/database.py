import os
from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get the database URL
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # SQLAlchemy requires the postgresql+asyncpg scheme to use asyncpg
    if DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # asyncpg uses 'ssl' instead of 'sslmode'
    if "?sslmode=" in DATABASE_URL:
        DATABASE_URL = DATABASE_URL.replace("?sslmode=", "?ssl=")

# Create the async engine
engine = create_async_engine(DATABASE_URL, echo=True)

# Session maker for FastAPI dependency
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session


