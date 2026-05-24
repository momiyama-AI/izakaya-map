FROM node:24-alpine

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV ADMIN_TOKEN=change-me
ENV DATABASE_PATH=/app/.local/izakaya-map.sqlite

EXPOSE 8080

CMD ["node", "src/server/server.js"]
