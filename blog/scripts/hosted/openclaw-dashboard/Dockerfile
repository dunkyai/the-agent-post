FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine
RUN addgroup -g 1001 -S openclaw && \
    adduser -u 1001 -S openclaw -G openclaw
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del python3 make g++ && \
    rm -rf /var/cache/apk/*
RUN apk add --no-cache ffmpeg curl && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" "https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key" | gpg --import && \
    curl -sLf --retry 3 --tlsv1.2 --proto "=https" "https://packages.doppler.com/public/cli/config.alpine.txt" >> /etc/apk/repositories && \
    apk add --no-cache doppler && \
    apk del curl
COPY --from=builder /app/dist/ ./dist/
COPY src/views/ ./dist/views/
COPY src/public/ ./dist/public/
RUN mkdir -p /data && chown openclaw:openclaw /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/openclaw.db
USER openclaw
EXPOSE 3000
ENTRYPOINT ["doppler", "run", "--"]
CMD ["node", "dist/index.js"]
