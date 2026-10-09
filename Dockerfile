# syntax=docker/dockerfile:1
FROM node:26.7.0-bookworm

WORKDIR /app

ENV NODE_ENV=development \
    ENABLE_AUTO_OCR=false \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System packages:
#   procps  -> provides `ps`, which Crawlee uses for memory snapshots
#   python3 -> OCR service
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Node dependencies (cached unless manifests change)
COPY package.json package-lock.json ./
COPY src/web/backend/package.json ./src/web/backend/
COPY src/web/frontend/package.json ./src/web/frontend/
RUN npm ci --ignore-scripts

# Python OCR dependencies
COPY services/ocr/requirements.txt ./services/ocr/
RUN pip3 install --no-cache-dir --break-system-packages -r services/ocr/requirements.txt

# Playwright: Chromium plus every system library it needs
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Prisma client
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm run db:generate

# App source
COPY . .

EXPOSE 5001 5173
CMD ["npm", "run", "start"]
