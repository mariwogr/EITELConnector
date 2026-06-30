FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static
COPY connectors.example.yaml /app/config/connectors.yaml

ENV EITEL_CATALOG_CONFIG=/app/config/connectors.yaml
ENV EITEL_CATALOG_TIMEOUT_SECONDS=8

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
