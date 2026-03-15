FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV NODE_ENV=production
ENV PORT=3600
ENV MAX_BROWSERS=5

EXPOSE 3600

USER pwuser

CMD ["node", "dist/index.js"]
