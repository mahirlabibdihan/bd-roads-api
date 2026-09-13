FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl sudo supervisor openssl wget jq \
      postgresql postgresql-postgis postgresql-postgis-scripts osm2pgsql \
      python3-pyosmium python3-psycopg2 redis-server \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --home-dir /srv/road-network --shell /bin/bash road-network

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN chmod +x docker/entrypoint.sh scripts/*.sh && mkdir -p /var/log/road-network
EXPOSE 5002
VOLUME ["/var/lib/postgresql", "/srv/road-network", "/srv/osm-pbf"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
