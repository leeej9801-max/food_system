FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml ./
COPY requirements.deploy.txt ./
RUN pip install --require-hashes -r requirements.deploy.txt
COPY app ./app
RUN pip install --no-deps . && useradd --create-home --uid 10001 food
COPY alembic.ini ./
COPY alembic ./alembic
COPY scripts ./scripts
USER food
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
