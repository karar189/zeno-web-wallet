# Instant Sync enclave image. Built reproducibly by ./build.sh; do not `docker build` it by hand
# if you want PCRs that match enclave-measurements.json.
#
# Reproducibility rules for this file:
#   - every base image is pinned by digest, every source by commit, every crate by Cargo.lock
#   - no apt-get / package managers (their output changes daily)
#   - SOURCE_DATE_EPOCH + buildx rewrite-timestamp normalize file times in layers
#   - anything that changes behaviour (e.g. ALLOWED_ORIGIN) is a build arg and so is measured
# Context: instant-sync-server/

ARG RUST_IMAGE=rust:1.93.0-bookworm@sha256:d0a4aa3ca2e1088ac0c81690914a0d810f2eee188197034edf366ed010a2b382
ARG NODE_IMAGE=node:22.21.1-bookworm-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c

# ── zcash-devtool, pinned commit ─────────────────────────────────────────────
FROM ${RUST_IMAGE} AS devtool
ARG DEVTOOL_REF
ARG SOURCE_DATE_EPOCH
ENV CARGO_INCREMENTAL=0 \
    RUSTFLAGS="-C link-arg=-Wl,--build-id=sha1 --remap-path-prefix=/build=/build --remap-path-prefix=/usr/local/cargo=/cargo"
WORKDIR /build/devtool
RUN test -n "${DEVTOOL_REF}" && echo "${DEVTOOL_REF}" | grep -Eq '^[0-9a-f]{40}$' \
 || { echo "DEVTOOL_REF must be a full commit sha" >&2; exit 1; }
RUN git init -q . && git remote add origin https://github.com/zcash/zcash-devtool.git \
 && git fetch -q --depth 1 origin "${DEVTOOL_REF}" && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${DEVTOOL_REF}"
RUN cargo build --release --locked && strip target/release/zcash-devtool

# ── enclave agent (NSM attestation, loopback, vsock bridges) ─────────────────
FROM ${RUST_IMAGE} AS agent
ARG SOURCE_DATE_EPOCH
ENV CARGO_INCREMENTAL=0 \
    RUSTFLAGS="-C link-arg=-Wl,--build-id=sha1 --remap-path-prefix=/build=/build --remap-path-prefix=/usr/local/cargo=/cargo"
WORKDIR /build/agent
COPY enclave/agent/Cargo.toml enclave/agent/Cargo.lock ./
COPY enclave/agent/src ./src
RUN cargo build --release --locked

# ── runtime ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}
ARG ALLOWED_ORIGIN
ARG LWD_HOSTS=testnet.zec.rocks
COPY --from=devtool /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=devtool /build/devtool/target/release/zcash-devtool /usr/local/bin/zcash-devtool
COPY --from=agent /build/agent/target/release/zeno-enclave-agent /usr/local/bin/zeno-enclave-agent
WORKDIR /app
COPY package.json server.mjs sealed.mjs ./
# /data lives in enclave RAM. Nothing survives a restart: clients get 401 and re-register.
ENV NODE_ENV=production \
    ENCLAVE=1 \
    REQUIRE_SEALED=1 \
    HOST=127.0.0.1 \
    PORT=8790 \
    DATA_DIR=/data \
    DEVTOOL_BIN=/usr/local/bin/zcash-devtool \
    ATTEST_BIN=/usr/local/bin/zeno-enclave-agent \
    LWD_SERVER=zecrocks \
    LWD_HOSTS=${LWD_HOSTS} \
    ALLOWED_ORIGIN=${ALLOWED_ORIGIN} \
    ALLOW_MAINNET=0 \
    TRUST_PROXY=1 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/usr/local/bin/zeno-enclave-agent", "init", "--", "node", "/app/server.mjs"]
