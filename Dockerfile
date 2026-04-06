# Use a slim version of Node.js for a smaller footprint
FROM node:20-slim AS base

# Set production environment
ENV NODE_ENV=production
WORKDIR /app

# Install dependencies (using a cache mount for faster builds)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Build the application
FROM deps AS build
COPY . .
# Only run build if your project has a build script (e.g., Next.js, Vite, TS)
# RUN npm run build

# Final runtime stage
FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Match the internal_port defined in your fly.toml
EXPOSE 8080

# Start the application
CMD [ "npm", "start" ]
