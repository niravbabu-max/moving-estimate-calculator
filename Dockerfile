# Use official Playwright image — has Chromium + all system deps pre-installed
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Skip browser download in postinstall — image already has Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package files
COPY package*.json ./

# Install ALL deps (need devDeps like tsx for build)
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Remove devDependencies for smaller production image
RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]
