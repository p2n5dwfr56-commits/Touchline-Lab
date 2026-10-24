#!/bin/sh
# Wrapper for tools/refresh-snapshot.mjs: Node in the cloud sandbox needs the proxy and its CA bundle.
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=1
[ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
exec node tools/refresh-snapshot.mjs "$@"
