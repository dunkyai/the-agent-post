FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine
RUN apk add --no-cache python3 make g++
RUN addgroup -g 1001 -S openclaw && \
    adduser -u 1001 -S openclaw -G openclaw
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ ./dist/
COPY src/views/ ./dist/views/
COPY src/public/ ./dist/public/
RUN mkdir -p /data && chown openclaw:openclaw /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/openclaw.db
USER openclaw
EXPOSE 3000
CMD ["node", "dist/index.js"]
