#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/geo/GeoWeedo}"
APP_USER="${APP_USER:-geo}"
SERVICE=/etc/systemd/system/geoweedo-lab-ingestion.service
TIMER=/etc/systemd/system/geoweedo-lab-ingestion.timer

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer with sudo."
  exit 1
fi

cat >"$SERVICE" <<EOF
[Unit]
Description=GeoWeedo automatic cannabis lab ingestion
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
EnvironmentFile=-$APP_DIR/.env.local
ExecStart=/usr/bin/npm run weedo:ingest:labs -- --provider=sc-labs --max=500 --refresh-hours=24
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

cat >"$TIMER" <<'EOF'
[Unit]
Description=Run GeoWeedo lab ingestion hourly

[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=300
Unit=geoweedo-lab-ingestion.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now geoweedo-lab-ingestion.timer
systemctl status geoweedo-lab-ingestion.timer --no-pager
