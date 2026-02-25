#!/bin/bash
# Import secrets from .env to Fly.io
# Usage: ./scripts/fly-secrets-import.sh
# Excludes: comments, empty lines, local-only vars, PORT, NODE_ENV (Fly manages these)

set -e

ENV_FILE="${1:-.env}"
APP="${FLY_APP_NAME:-habeat-server}"

# Vars to exclude (local-only or Fly-managed)
EXCLUDE='^(MONGO_URL_LOCAL|OLLAMA_BASE_URL|PORT|NODE_ENV|NODE_DEBUG_LOG|DEV_CLIENT_SITE)='

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

echo "Importing secrets from $ENV_FILE to $APP..."
echo "Excluding: $EXCLUDE"
echo ""

grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep -vE "$EXCLUDE" | fly secrets import -a "$APP"

echo ""
echo "Done. Secrets imported."
