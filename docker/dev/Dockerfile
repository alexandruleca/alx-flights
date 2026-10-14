# Dev runtime for ingest / api / web. Source and node_modules are bind-mounted
# (see docker-compose.yml), so this image only adds `ps`: `nest start --watch`
# needs it to stop the previous process on reload. Without it every reload
# leaves the old ingest/API process running alongside the new one.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*
