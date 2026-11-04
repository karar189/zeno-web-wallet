#!/usr/bin/env bash
# Reproducible build of the Instant Sync enclave image (EIF) and its PCR measurements.
#
#   ./enclave/build.sh            build, write enclave/measurements.json and the frontend copy
#   ./enclave/build.sh --verify   rebuild from the committed sources and fail unless PCR0/1/2
#                                 equal the committed measurements.json (anyone can run this)
#
# Needs: Linux x86_64, docker with buildx, nitro-cli (aws-nitro-enclaves-cli), jq, git.
# Inputs that determine the PCRs (all recorded in measurements.json):
#   the committed server sources, enclave/Dockerfile + agent, DEVTOOL_REF, ALLOWED_ORIGIN,
#   the pinned base image digests, BuildKit version, and the nitro-cli kernel/init blobs.
set -euo pipefail

cd "$(dirname "$0")/.."               # instant-sync-server/
REPO_ROOT=$(git rev-parse --show-toplevel)
MEAS=enclave/measurements.json
FRONTEND_MEAS="$REPO_ROOT/frontend/src/features/instant-sync/enclave-measurements.json"
VERIFY=0
[[ "${1:-}" == "--verify" ]] && VERIFY=1

BUILDKIT_IMAGE="moby/buildkit:v0.17.3"
INPUTS=(package.json server.mjs sealed.mjs enclave/Dockerfile enclave/agent/Cargo.toml enclave/agent/Cargo.lock enclave/agent/src)

if [[ $VERIFY == 1 ]]; then
  [[ -f $MEAS ]] || { echo "no $MEAS to verify against" >&2; exit 1; }
  DEVTOOL_REF=$(jq -r .devtoolRef "$MEAS")
  ALLOWED_ORIGIN=$(jq -r .allowedOrigin "$MEAS")
  BUILDKIT_IMAGE=$(jq -r .buildkit "$MEAS")
else
  : "${DEVTOOL_REF:?set DEVTOOL_REF to a zcash-devtool commit sha}"
  : "${ALLOWED_ORIGIN:?set ALLOWED_ORIGIN to the web app origin}"
fi

# Sources must be committed: the build is identified by the commit that last touched them.
if [[ -n "$(git status --porcelain -- "${INPUTS[@]}")" ]]; then
  echo "uncommitted changes in enclave inputs; commit them first:" >&2
  git status --short -- "${INPUTS[@]}" >&2
  exit 1
fi
SOURCE_COMMIT=$(git log -1 --format=%H -- "${INPUTS[@]}")
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct -- "${INPUTS[@]}")
export SOURCE_DATE_EPOCH

# Build from a clean export of exactly that commit, not the working tree.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
(cd "$REPO_ROOT" && git archive "$SOURCE_COMMIT" -- instant-sync-server) | tar -x -C "$WORK"
CTX="$WORK/instant-sync-server"
find "$CTX" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

BUILDER=zeno-repro
docker buildx inspect "$BUILDER" >/dev/null 2>&1 \
  || docker buildx create --name "$BUILDER" --driver docker-container --driver-opt "image=$BUILDKIT_IMAGE" >/dev/null

TAG="zeno-instant-sync-enclave:$SOURCE_COMMIT"
docker buildx build --builder "$BUILDER" --platform linux/amd64 --no-cache \
  --build-arg SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  --build-arg DEVTOOL_REF="$DEVTOOL_REF" \
  --build-arg ALLOWED_ORIGIN="$ALLOWED_ORIGIN" \
  --provenance=false --sbom=false \
  --output "type=docker,name=$TAG,rewrite-timestamp=true" \
  -f "$CTX/enclave/Dockerfile" "$CTX"

mkdir -p enclave/out
nitro-cli build-enclave --docker-uri "$TAG" --output-file enclave/out/instant-sync.eif > "$WORK/eif.json"
PCR0=$(jq -r .Measurements.PCR0 "$WORK/eif.json")
PCR1=$(jq -r .Measurements.PCR1 "$WORK/eif.json")
PCR2=$(jq -r .Measurements.PCR2 "$WORK/eif.json")
NITRO_CLI=$(nitro-cli --version | awk '{print $NF}')
BLOBS=$(cd /usr/share/nitro_enclaves/blobs && sha256sum -- * | sha256sum | cut -d' ' -f1)
EIF_SHA=$(sha256sum enclave/out/instant-sync.eif | cut -d' ' -f1)

echo "PCR0 $PCR0"
echo "PCR1 $PCR1"
echo "PCR2 $PCR2"

if [[ $VERIFY == 1 ]]; then
  ok=1
  for k in pcr0 pcr1 pcr2 nitroCli blobsSha256; do
    want=$(jq -r ".$k" "$MEAS")
    case $k in pcr0) got=$PCR0;; pcr1) got=$PCR1;; pcr2) got=$PCR2;; nitroCli) got=$NITRO_CLI;; blobsSha256) got=$BLOBS;; esac
    if [[ "$want" != "$got" ]]; then echo "MISMATCH $k: committed $want, rebuilt $got" >&2; ok=0; fi
  done
  [[ $ok == 1 ]] && echo "verify: PCRs match $MEAS (source $SOURCE_COMMIT)" || exit 1
  exit 0
fi

jq -n --arg pcr0 "$PCR0" --arg pcr1 "$PCR1" --arg pcr2 "$PCR2" \
  --arg sourceCommit "$SOURCE_COMMIT" --arg sourceDateEpoch "$SOURCE_DATE_EPOCH" \
  --arg devtoolRef "$DEVTOOL_REF" --arg allowedOrigin "$ALLOWED_ORIGIN" \
  --arg buildkit "$BUILDKIT_IMAGE" --arg nitroCli "$NITRO_CLI" --arg blobsSha256 "$BLOBS" --arg eifSha256 "$EIF_SHA" \
  '{pcr0:$pcr0,pcr1:$pcr1,pcr2:$pcr2,sourceCommit:$sourceCommit,sourceDateEpoch:($sourceDateEpoch|tonumber),
    devtoolRef:$devtoolRef,allowedOrigin:$allowedOrigin,buildkit:$buildkit,nitroCli:$nitroCli,
    blobsSha256:$blobsSha256,eifSha256:$eifSha256}' > "$MEAS"

jq --arg c "Written by instant-sync-server/enclave/build.sh. The client only talks to an enclave whose PCR0/1/2 match these values." \
  '{comment:$c,pcr0,pcr1,pcr2,nitroCli,sourceCommit}' "$MEAS" > "$FRONTEND_MEAS"

echo "wrote $MEAS and $FRONTEND_MEAS. Commit both, then rebuild the frontend."
