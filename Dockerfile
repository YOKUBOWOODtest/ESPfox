# Production image for Render.
#
# Next.js is served by `server/index.ts`, which also carries the Socket.io
# endpoint. A custom server and `output: "standalone"` are mutually exclusive
# (Next's docs are explicit about that), so the image keeps the full build and
# the runtime dependencies instead of the traced standalone folder.

FROM node:24-alpine

RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so a source edit does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Node 24 runs the TypeScript server directly; it only uses erasable syntax.
CMD ["node", "server/index.ts"]
