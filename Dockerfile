FROM node:24-alpine

WORKDIR /app

COPY . .
RUN mkdir -p /app/.local

ENV NODE_ENV=production
ENV PORT=8080
ENV ADMIN_TOKEN=change-me
ENV DATABASE_PATH=/app/.local/izakaya-map.sqlite
ENV REQUIRE_TURSO=false

EXPOSE 8080

CMD ["node", "src/server/server.js"]
