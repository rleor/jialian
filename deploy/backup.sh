#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
umask 077
backup_file="backups/jialian-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U jialian -d jialian -Fc > "$backup_file"
printf 'Backup saved: %s\n' "$backup_file"
