ARG BASE_IMAGE=public.ecr.aws/supabase/postgres-meta:v0.93.1
FROM ${BASE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash curl socat ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x /app/docker/entrypoint.sh

ENV NODE_ENV=production
ENV POLYMARKET_REQUEST_TIMEOUT_MS=30000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "./bin/pm_mcp_stdio.mjs"]
