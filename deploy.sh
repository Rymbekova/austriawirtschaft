#!/usr/bin/env bash
# Installs the Austria Wirtschaft site on a fresh Ubuntu/Debian server (e.g. Hetzner)
# with nginx and a free HTTPS certificate from Let's Encrypt.
# Run as root from the unzipped folder:   bash deploy.sh you@example.com
set -euo pipefail

DOMAIN="austriawirtschaft.online"
EMAIL="${1:-}"
WEBROOT="/var/www/${DOMAIN}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Please run as root (or with sudo)."; exit 1; fi
if [ -z "$EMAIL" ]; then echo "Usage: bash deploy.sh your-email@example.com  (used for certificate expiry notices)"; exit 1; fi

echo "==> Installing nginx and certbot"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Copying site files to ${WEBROOT}"
mkdir -p "$WEBROOT"
cp -r "$HERE/index.html" "$HERE/data.js" "$HERE/companies.js" "$HERE/laender.json" "$HERE/vendor" "$HERE/data" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

echo "==> Configuring nginx"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};
    root ${WEBROOT};
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~* \.(js|json|css|svg|png|jpg|ico)\$ {
        expires 1h;
        add_header Cache-Control "public";
    }

    gzip on;
    gzip_types text/html application/javascript application/json text/css image/svg+xml;
}
NGINX
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Opening the firewall for web traffic (if ufw is active)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full'
fi

echo "==> Getting the HTTPS certificate"
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" \
  -d "$DOMAIN" -d "www.${DOMAIN}" --redirect

echo
echo "Done. Visit https://${DOMAIN}"
