#!/bin/sh
# Basic deployment smoke test for a Genote cloud preview.

set -eu

BASE_URL="${1:-http://127.0.0.1:8502}"
API_URL="${BASE_URL%/}/api"

echo "Checking web UI at ${BASE_URL}..."
curl -fsS "${BASE_URL}" >/dev/null

echo "Checking API config through frontend proxy..."
curl -fsS "${API_URL}/config" >/dev/null

echo "Checking local API health..."
curl -fsS "http://127.0.0.1:5055/health" >/dev/null

echo "Genote cloud smoke test passed."
