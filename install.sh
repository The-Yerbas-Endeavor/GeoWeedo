#!/usr/bin/env bash
set -euo pipefail

APP_USER="${SUDO_USER:-$USER}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
APP_DIR="${GEOWEEDO_DIR:-$APP_HOME/GeoWeedo}"
DOMAIN="${GEOWEEDO_DOMAIN:-geoweedo.yerbas.org}"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash install.sh"
  exit 1
fi

echo "==> Installing GeoWeedo dependencies"
apt-get update
apt-get install -y git curl build-essential nginx sqlite3 ca-certificates openssl

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "SQLite CLI installation failed; sqlite3 is required."
  exit 1
fi

echo "==> Using SQLite $(sqlite3 --version | awk '{print $1}')"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Using Node $(node --version)"

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone https://github.com/The-Yerbas-Endeavor/GeoWeedo.git "$APP_DIR"
fi

cd "$APP_DIR"
sudo -u "$APP_USER" git pull --ff-only || true
sudo -u "$APP_USER" npm install

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  chown "$APP_USER:$APP_USER" .env.local
fi

if grep -q '^GEOWEEDO_SESSION_SECRET=$' .env.local; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  sed -i "s/^GEOWEEDO_SESSION_SECRET=$/GEOWEEDO_SESSION_SECRET=$SESSION_SECRET/" .env.local
  unset SESSION_SECRET
fi

chmod 600 .env.local
chown "$APP_USER:$APP_USER" .env.local

mkdir -p data/runtime public/uploads/dispensaries
chown -R "$APP_USER:$APP_USER" data/runtime public/uploads
chmod 750 data/runtime

echo "==> Initializing SQLite schema"
sudo -u "$APP_USER" npm run db:init
chmod 640 data/runtime/geoweedo.sqlite || true
chown "$APP_USER:$APP_USER" data/runtime/geoweedo.sqlite || true

echo "==> Verifying SQLite database"
sudo -u "$APP_USER" sqlite3 data/runtime/geoweedo.sqlite "PRAGMA integrity_check;" | grep -qx 'ok'
sudo -u "$APP_USER" sqlite3 data/runtime/geoweedo.sqlite "SELECT COUNT(*) FROM schema_migrations;" >/dev/null

if ! sudo -u "$APP_USER" sqlite3 data/runtime/geoweedo.sqlite "SELECT username FROM admin_users LIMIT 1;" | grep -q .; then
  echo
  echo "Create the first GeoWeedo administrator"
  read -r -p "Admin username: " ADMIN_USERNAME
  read -r -p "Admin display name [$ADMIN_USERNAME]: " ADMIN_DISPLAY
  ADMIN_DISPLAY="${ADMIN_DISPLAY:-$ADMIN_USERNAME}"
  read -r -s -p "Admin password (12+ characters): " ADMIN_PASSWORD
  echo
  if [[ ${#ADMIN_PASSWORD} -lt 12 ]]; then
    echo "Password must contain at least 12 characters."
    exit 1
  fi
  sudo -u "$APP_USER" env \
    GEOWEEDO_ADMIN_USERNAME="$ADMIN_USERNAME" \
    GEOWEEDO_ADMIN_DISPLAY_NAME="$ADMIN_DISPLAY" \
    GEOWEEDO_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    npm run admin:create
  unset ADMIN_PASSWORD
fi

sudo -u "$APP_USER" rm -rf .next
sudo -u "$APP_USER" npm run build

cat >/etc/systemd/system/geoweedo.service <<EOF
[Unit]
Description=GeoWeedo Next.js
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.local
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/geoweedo-wallet-worker.service <<EOF
[Unit]
Description=GeoWeedo restricted YERB wallet worker
After=network.target geoweedo.service

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm run wallet:worker
PrivateTmp=true
NoNewPrivileges=true
EOF

cat >/etc/systemd/system/geoweedo-wallet-worker.timer <<EOF
[Unit]
Description=Run GeoWeedo YERB wallet worker every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true
Unit=geoweedo-wallet-worker.service

[Install]
WantedBy=timers.target
EOF

if [[ ! -f /etc/nginx/sites-available/geoweedo ]]; then
  echo "==> Creating Nginx site"
  cat >/etc/nginx/sites-available/geoweedo <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  ln -sf /etc/nginx/sites-available/geoweedo /etc/nginx/sites-enabled/geoweedo
else
  echo "==> Preserving existing Nginx site (including any Certbot/TLS configuration)"
fi

nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now geoweedo
systemctl enable --now geoweedo-wallet-worker.timer

echo
echo "GeoWeedo installed."
echo "Database: $APP_DIR/data/runtime/geoweedo.sqlite"
echo "Admin login: https://$DOMAIN/admin/login"
echo "App status: systemctl status geoweedo --no-pager"
echo "Wallet timer: systemctl status geoweedo-wallet-worker.timer --no-pager"
echo "Withdrawals remain disabled until YERB_WITHDRAWALS_ENABLED=true is set in .env.local."
