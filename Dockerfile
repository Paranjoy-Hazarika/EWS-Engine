# Stage 1: build the React app
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Flask API + the built app, served by gunicorn
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=web /web/dist ./static
ENV APP_ENV=production
EXPOSE 8000
# ONE worker with many threads: live updates (SSE) and the simulator live in this process's memory.
CMD ["gunicorn", "-w", "1", "--threads", "64", "--timeout", "0", "-b", "0.0.0.0:8000", "app:app"]
