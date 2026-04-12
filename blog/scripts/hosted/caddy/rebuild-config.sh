#!/bin/bash
# Regenerate Caddy JSON config with all instance routes.
# Run this after Caddy restarts or the Caddyfile changes.
# Usage: ./rebuild-config.sh [--reload]

set -euo pipefail

CADDYFILE="/opt/agentpost/Caddyfile"
JSON_CONFIG="/opt/agentpost/caddy-config.json"
PROVISIONING_DB="/opt/agentpost/data/instances.db"

# Convert Caddyfile to JSON
caddy adapt --config "$CADDYFILE" --adapter caddyfile > "$JSON_CONFIG" 2>/dev/null

# Get all active instances from provisioning DB
INSTANCES=$(sqlite3 -separator '|' "$PROVISIONING_DB" "SELECT id, port FROM instances WHERE status='running';")

# Insert instance routes at position 0 in the JSON config
python3 -c "
import json, sys

with open('$JSON_CONFIG') as f:
    config = json.load(f)

routes = config['apps']['http']['servers']['srv0']['routes']

instances = '''$INSTANCES'''.strip().split('\n')
for line in reversed(instances):
    if not line.strip():
        continue
    sub, port = line.strip().split('|')
    routes.insert(0, {
        '@id': f'openclaw-{sub}',
        'match': [{'host': [f'{sub}.dunky.ai']}],
        'handle': [{'handler': 'subroute', 'routes': [{'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': f'localhost:{port}'}]}]}]}],
        'terminal': True
    })

with open('$JSON_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)

print(f'Config ready: {len(routes)} routes ({len(instances)} instances)')
"

if [ "${1:-}" = "--reload" ]; then
  caddy reload --config "$JSON_CONFIG" 2>&1 | grep -v "level.*info"
  echo "Caddy reloaded"
fi
