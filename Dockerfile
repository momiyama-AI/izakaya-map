FROM node:24-alpine

WORKDIR /app

COPY . .
RUN mkdir -p /app/storage /app/.local

ENV NODE_ENV=production
ENV PORT=8080
ENV ADMIN_TOKEN=change-me
ENV DATABASE_PATH=/app/storage/izakaya-map.sqlite

EXPOSE 8080

CMD ["node", "src/server/server.js"]
