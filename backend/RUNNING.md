# Running OmniBase Locally

Here are the commands to run in separate terminal tabs to start the application with Redis, WebSockets, and Background Tasks enabled:

---

## 1. Start the Redis Server
Run this once to boot up your Redis instance:
```bash
docker run -d --name omnibase-redis -p 6379:6379 redis
```

---

## 2. Run the Background Task Worker
Run this from the `backend/` directory to handle background tasks (like sending invite emails):
```bash
cd backend
.\venv\Scripts\arq app.worker.WorkerSettings
```

---

## 3. Run the FastAPI Web Server
Run this from the `backend/` directory to start the API and WebSockets server:
```bash
cd backend
.\venv\Scripts\python -m uvicorn main:app --reload
```

---

## 4. Run Database Migrations (Only if you modify models.py)
```bash
cd backend
.\venv\Scripts\alembic revision --autogenerate -m "describe_changes"
.\venv\Scripts\alembic upgrade head
```
