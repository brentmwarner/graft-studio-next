FROM node:22.22.0-bookworm@sha256:2e3d655fd1e3ffaa6b5f23ee9f3905a0fd9e8c0a65df94c8ae6e4d18a0f48870 AS dependencies

WORKDIR /runtime
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false \
  && npm cache clean --force

FROM scratch
COPY --from=dependencies /usr/local/bin/node /bin/node
COPY --from=dependencies /usr/local/LICENSE /licenses/node/LICENSE
COPY --from=dependencies /runtime/node_modules /node_modules
