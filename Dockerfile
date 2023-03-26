FROM node:16-alpine as build

RUN apk add python3 make g++ libexecinfo-dev

WORKDIR /tmp/buildApp

COPY ./package*.json ./

RUN npm install
COPY . .
RUN npm run build

FROM node:16-alpine as production

RUN apk add dumb-init binutils python3 make g++ libexecinfo-dev

ENV NODE_ENV=production
ENV SERVER_PORT=8080


WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci --only=production

COPY --chown=node:node --from=build /tmp/buildApp/dist .
COPY --chown=node:node ./config ./config


USER node
EXPOSE ${SERVER_PORT}
CMD ["dumb-init", "node", "--max_old_space_size=512", "./index.js"]
