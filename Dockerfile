# Hugging Face Spaces (Docker SDK) için tek imaj: React arayüzü derlenir, FastAPI hem API'yi
# hem derlenmiş arayüzü 7860 portunda sunar.

# ---------------------------------------------------------------- 1) arayüzü derle
FROM node:20-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- 2) Python çalışma ortamı
FROM python:3.11-slim

# Spaces konteyneri 1000 numaralı kullanıcıyla çalıştırır; yazılabilir klasörler /tmp altında
ENV PYTHONUNBUFFERED=1 \
    NUMBA_CACHE_DIR=/tmp/numba \
    CFLP_CACHE_DIR=/tmp/cflp-cache \
    JOB_WORKERS=2 \
    BENCH_WORKERS=2
RUN useradd -m -u 1000 user
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY --chown=user backend/ backend/
COPY --chown=user config/ config/
COPY --chown=user data/processed/ data/processed/
COPY --chown=user precomputed/ precomputed/
COPY --chown=user --from=web /app/frontend/dist frontend/dist

USER user
EXPOSE 7860
CMD ["python", "-m", "uvicorn", "api.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "7860"]
