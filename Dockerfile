# syntax=docker/dockerfile:1
#
# Scraper and web workspace image.
#
# This image is optional. It is only needed to run the crawler itself inside a
# container, which is worth doing on a VPS so scrapes do not depend on a laptop
# being awake. The long-lived parts of the stack (Postgres, Redis, the OCR
# service) are separate images.
#
# Build:
#   docker build -t samaniti-app .

FROM node:22-bookworm-slim

# Chromium, which Playwright drives, needs these shared libraries. Without them
# the browser launches and then dies with a missing-libc error, which surfaces as
# an unhelpful crawler timeout rather than as a missing dependency.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        openssl \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libx11-6 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency manifests first, so a source-only change does not reinstall the
# tree. The two workspace manifests are needed as well because `npm ci` installs
# from the root lockfile, which pins them.
COPY package.json package-lock.json ./
COPY src/web/backend/package.json ./src/web/backend/
COPY src/web/frontend/package.json ./src/web/frontend/
RUN npm ci --ignore-scripts

# Prisma generates its client from the schema during `npm ci`'s postinstall,
# which is skipped above, so it runs explicitly here where the schema is known.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm run db:generate

# Playwright's browsers and their OS dependencies. This was the gap that made
# this image useless for crawling: the package was installed as a runtime
# dependency but no browser was ever downloaded, so every request would fail.
RUN npx playwright install --with-deps chromium \
    && npm cache clean --force

COPY . .

# The workspace router is gated on NODE_ENV, and a container running crawls is a
# development-style deployment. Set NODE_ENV=production to serve the collected
# records read-only.
ENV NODE_ENV=development \
    ENABLE_AUTO_OCR=false

EXPOSE 5001 5173

CMD ["npm", "run", "start"]
