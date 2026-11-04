# syntax=docker/dockerfile:1
# Stage 1: build zcash-devtool. Pinned to bookworm so the binary's glibc matches stage 2.
FROM rust:1-bookworm AS devtool
ARG DEVTOOL_REF=main
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/zcash/zcash-devtool.git . && git checkout "${DEVTOOL_REF}"
RUN cargo build --release --locked && strip target/release/zcash-devtool

# Stage 2: Node runtime, non-root, data on a volume.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin zeno \
 && mkdir -p /data \
 && chown zeno:zeno /data \
 && chmod 700 /data
COPY --from=devtool /src/target/release/zcash-devtool /usr/local/bin/zcash-devtool
WORKDIR /app
COPY package.json server.mjs ./
USER zeno
ENV NODE_ENV=production \
    PORT=8790 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    DEVTOOL_BIN=/usr/local/bin/zcash-devtool \
    LWD_SERVER=zecrocks \
    TRUST_PROXY=1 \
    ALLOW_MAINNET=0
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
