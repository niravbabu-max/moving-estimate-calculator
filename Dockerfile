# Official Playwright image v1.52.0 — exact version match with npm package
# Includes Chromium + ALL required system libraries (libglib, libnss, etc.)
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Browsers are already in the image — skip postinstall download
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/index.cjs"]
