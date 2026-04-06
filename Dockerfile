# Use Playwright base image for system libraries (libglib, libnss, etc.)
# Let postinstall download the exact Chromium revision matching our npm version
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package*.json ./

# npm ci runs postinstall: downloads correct Chromium into /root/.cache/ms-playwright/
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/index.cjs"]
