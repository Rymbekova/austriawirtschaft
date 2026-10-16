#!/usr/bin/env bash
# Updates the live site with the files in this folder. Run as root:  bash update.sh
set -euo pipefail
WEBROOT="/var/www/austriawirtschaft.online"
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$WEBROOT/data"
cp -r "$HERE/index.html" "$HERE/data.js" "$HERE/companies.js" "$HERE/laender.json" "$HERE/vendor" "$HERE/data" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"
echo "Updated. Reload https://austriawirtschaft.online (Ctrl+Shift+R to skip the cache)."
