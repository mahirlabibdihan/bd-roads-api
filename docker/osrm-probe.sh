#!/usr/bin/env bash
set -euo pipefail
# The official image has Bash and timeout, but no curl or wget.
exec 3<>/dev/tcp/127.0.0.1/5000
printf 'GET /nearest/v1/foot/90.4125,23.8103?number=1 HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&3
IFS= read -r status <&3
[[ "$status" == *" 200 "* ]]
