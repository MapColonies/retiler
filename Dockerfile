FROM node:20-bullseye as build

WORKDIR /tmp/buildApp

# Install build dependencies for sharp (Debian uses apt-get)
RUN apt-get update && apt-get install -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY ./package*.json ./
COPY .husky/ .husky/
RUN npm install

COPY . .
RUN npm run build

FROM node:20-bullseye-slim as production

RUN apt-get update && apt-get install -y dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV SERVER_PORT=8080

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./
COPY .husky/ .husky/
RUN npm ci --only=production

COPY --chown=node:node --from=build /tmp/buildApp/dist .
COPY --chown=node:node ./config ./config

USER node
EXPOSE ${SERVER_PORT}
CMD ["dumb-init", "node", "--import", "./instrumentation.mjs", "./index.js"]
