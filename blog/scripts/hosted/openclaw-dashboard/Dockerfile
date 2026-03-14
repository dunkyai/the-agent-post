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
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ ./dist/
COPY src/views/ ./dist/views/
COPY src/public/ ./dist/public/
RUN mkdir -p /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/openclaw.db
EXPOSE 3000
CMD ["node", "dist/index.js"]
