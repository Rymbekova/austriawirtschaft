# austriawirtschaft.online

Active Austrian companies from the justizonline Firmenbuch extract, mapped by state, district, municipality, place and exact address.

Static site (HTML + JS + JSON), served by nginx.

## Update the live site
On the server:

    cd ~/austriawirtschaft && git pull && bash update.sh

## Data
- Companies: justizonline Firmenbuch extract (active companies). Only company-level fields are published; personal data of owners and managers is not.
- Positions: © Österreichisches Adressregister, Stichtagsdaten vom 01.04.2026 (BEV, CC BY 4.0). `geocoding/geocode_addresses.py` matches addresses on the server.
- Boundaries: GeoJSON-TopoJSON-Austria (ginseng666). Postcodes: GeoNames via zauberware.
- Basemap: © OpenStreetMap contributors.
