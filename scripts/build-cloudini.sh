#!/bin/sh
set -eu
# Regenerate the checked-in, self-contained worker codec. No runtime CDN or native asset fetch.
docker build --file infra/cloudini/Dockerfile.wasm --target artifact \
  --output type=local,dest=src/utils/cloudini/vendor .
