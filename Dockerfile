# Builds one service from the monorepo: docker build --build-arg SERVICE=telephony .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci --ignore-scripts
ARG SERVICE
RUN ./node_modules/.bin/tsc -b services/${SERVICE} \
 && npm prune --omit=dev --ignore-scripts \
 && rm -rf packages/*/src packages/*/test services/*/src services/*/test

FROM node:22-slim
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE}
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["sh", "-c", "exec node services/${SERVICE}/dist/server.js"]
