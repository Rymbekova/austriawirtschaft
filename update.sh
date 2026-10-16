#!/usr/bin/env bash
# Updates the live site with the files in this folder. Run as root:  bash update.sh
set -euo pipefail
WEBROOT="/var/www/austriawirtschaft.online"
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$WEBROOT/data" "$WEBROOT/data.js"
cp -r "$HERE/index.html" "$HERE/companies.js" "$HERE/laender.json" "$HERE/vendor" "$HERE/data" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

# Browsers may keep scripts and data for at most 1 hour (older setups used 7 days).
CONF="/etc/nginx/sites-available/austriawirtschaft.online"
if [ -f "$CONF" ] && grep -q "expires 7d;" "$CONF"; then
  sed -i 's/expires 7d;/expires 1h;/' "$CONF" && nginx -t && systemctl reload nginx
fi
echo "Updated. Reload https://austriawirtschaft.online"
