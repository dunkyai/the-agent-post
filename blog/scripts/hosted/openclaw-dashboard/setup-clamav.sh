#!/bin/bash
# Set up ClamAV antivirus scanner as a Docker sidecar container.
# Run once on the server. The container auto-updates virus definitions.
#
# Dashboard containers connect via host.docker.internal:3310 (CLAMD_HOST env var).

set -euo pipefail

CONTAINER_NAME="openclaw-clamav"
IMAGE="clamav/clamav:stable"
VOLUME="clamav-db"

echo "Setting up ClamAV scanner..."

# Pull latest image
docker pull "$IMAGE"

# Stop existing container if running
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# Create volume for virus definitions (persists across restarts)
docker volume create "$VOLUME" 2>/dev/null || true

# Run ClamAV daemon
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p 3310:3310 \
  -v "$VOLUME:/var/lib/clamav" \
  "$IMAGE"

echo "Waiting for ClamAV to initialize (downloading virus definitions on first run)..."
echo "This may take 2-3 minutes on first run."

# Wait for clamd to be ready
for i in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" clamdscan --ping 2>/dev/null; then
    echo "ClamAV is ready!"
    echo ""
    echo "Container: $CONTAINER_NAME"
    echo "Port: 3310"
    echo "Dashboard env: CLAMD_HOST=host.docker.internal CLAMD_PORT=3310"
    exit 0
  fi
  sleep 5
done

echo "WARNING: ClamAV did not become ready within 5 minutes."
echo "Check logs: docker logs $CONTAINER_NAME"
