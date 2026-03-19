#!/usr/bin/env bash
# Diagnostic complet de l'environnement projet (containers, services, configs)
set -euo pipefail

OUTPUT_DIR=".diagnostics/diagnostic-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTPUT_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$OUTPUT_DIR/diagnostic.log"
}

run_diagnostic() {
  local name="$1"
  local output_file="$2"
  shift 2

  log "▶ $name..."
  {
    echo "=== $name ==="
    echo "Timestamp: $(date)"
    echo ""
  } >"$OUTPUT_DIR/$output_file"

  if "$@" >>"$OUTPUT_DIR/$output_file" 2>&1; then
    log "  ✅ $name OK"
  else
    local status=$?
    log "  ❌ $name FAILED (exit code: $status)"
  fi
}

log "🚀 Début du diagnostic complet appli-positionnement"

COMPOSE_FILE="project/docker-compose.yml"
HTTPS_PORT_VALUE="${HTTPS_PORT:-443}"

# 1. Informations système
log "📊 Section 1: Informations système"
run_diagnostic "Version Docker" "01-docker-version.txt" docker version
run_diagnostic "Version Docker Compose" "01-docker-compose-version.txt" docker compose version
run_diagnostic "Informations système" "01-system-info.txt" sh -c "uname -a && df -h && free -h"

# 2. État des conteneurs
log "📦 Section 2: État des conteneurs"
run_diagnostic "Liste des conteneurs" "02-containers-list.txt" docker compose -f "$COMPOSE_FILE" ps -a
run_diagnostic "Stats des conteneurs" "02-containers-stats.txt" docker compose -f "$COMPOSE_FILE" ps --format json
run_diagnostic "Inspection des conteneurs" "02-containers-inspect.txt" sh -c 'docker compose -f project/docker-compose.yml ps -q | xargs -r docker inspect'

# 3. Santé HTTP / TLS
log "🏥 Section 3: Santé HTTP / TLS"
run_diagnostic "Curl localhost (HEAD)" "03-health-localhost.txt" sh -c "curl -k -I https://localhost:${HTTPS_PORT_VALUE}/ || true"
run_diagnostic "Curl docker (HEAD)" "03-health-docker.txt" sh -c "curl -k -I https://docker:${HTTPS_PORT_VALUE}/ || true"
run_diagnostic "Curl localhost (verbose)" "03-health-localhost-verbose.txt" sh -c "curl -kv https://localhost:${HTTPS_PORT_VALUE}/ -o /dev/null || true"
run_diagnostic "Curl docker (verbose)" "03-health-docker-verbose.txt" sh -c "curl -kv https://docker:${HTTPS_PORT_VALUE}/ -o /dev/null || true"
run_diagnostic "TLS docker via openssl" "03-tls-docker-openssl.txt" sh -c "openssl s_client -connect docker:${HTTPS_PORT_VALUE} -servername localhost </dev/null || true"

# 4. Logs des services (dernières 400 lignes)
log "📝 Section 4: Logs des services"
SERVICE_LIST=$(docker compose -f "$COMPOSE_FILE" ps --services 2>/dev/null || true)
if [ -n "$SERVICE_LIST" ]; then
  for service in $SERVICE_LIST; do
    run_diagnostic "Logs $service" "04-logs-${service}.txt" docker compose -f "$COMPOSE_FILE" logs --tail=400 "$service"
  done
else
  log "  ⚠️ Aucun service détecté via docker compose ps --services"
fi

# 5. Configuration réseau
log "🌐 Section 5: Réseau"
run_diagnostic "Networks Docker" "05-networks.txt" docker network ls
run_diagnostic "Ports exposés" "05-ports.txt" docker compose -f "$COMPOSE_FILE" ps --format '{{.Service}}\t{{.Ports}}'
run_diagnostic "Résolution DNS 'docker'" "05-hosts-docker.txt" sh -c "getent hosts docker || nslookup docker || ping -c1 docker || true"

# 6. Fichiers d'environnement
log "⚙️ Section 6: Environnements"
run_diagnostic ".env.dist" "06-env-dist.txt" cat .env.dist
run_diagnostic ".env.dev" "06-env-dev.txt" cat .env.dev
run_diagnostic ".env" "06-env.txt" cat .env

# 7. Variables d'env dans les conteneurs clés
log "🧩 Section 7: Variables d'env conteneurs"
IMPORTANT_CONTAINERS=(php backend-db grist pgadmin)
for container in "${IMPORTANT_CONTAINERS[@]}"; do
  run_diagnostic "Env $container" "07-env-${container}.txt" docker compose -f "$COMPOSE_FILE" exec -T "$container" env
done

log "✅ Diagnostic terminé - résultats dans $OUTPUT_DIR"
