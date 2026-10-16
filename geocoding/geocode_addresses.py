#!/usr/bin/env python3
"""Geocode the justizonline company addresses with the official Austrian address register (BEV).

Run on the server (it needs internet access to download the register, ~150 MB):

    python3 geocode_addresses.py justizonline_all_companies.csv.gz

Output: geocoded.csv.gz with  fb_nummer, lat, lon, precision
  precision = "address"  exact street + house number match
              "street"   street found, house number not (centre of that street)
              ""         no match (the site falls back to the postcode/place)

Data source: © Österreichisches Adressregister (BEV), CC BY 4.0.
"""
import csv, gzip, io, re, sys, unicodedata, urllib.request, zipfile
from collections import defaultdict
from pathlib import Path

import pandas as pd
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
CACHE = HERE / "bev"
CACHE.mkdir(exist_ok=True)

# Newest first; the last one is a confirmed archive link (Stichtag 01.04.2025).
CANDIDATE_URLS = [
    "https://data.bev.gv.at/download/Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_20261001.zip",
    "https://data.bev.gv.at/download/Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_20260401.zip",
    "https://data.bev.gv.at/download/Adressregister/Archiv_Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_20260401.zip",
    "https://data.bev.gv.at/download/Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_20251001.zip",
    "https://data.bev.gv.at/download/Adressregister/Archiv_Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_20251001.zip",
    "https://data.bev.gv.at/download/Adressregister/Archiv_Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_20250401.zip",
]


def download_register():
    existing = sorted(CACHE.glob("Adresse_Relationale_Tabellen_Stichtagsdaten_*.zip"))
    if existing:
        print(f"Using cached {existing[-1].name}")
        return existing[-1]
    for url in CANDIDATE_URLS:
        name = url.rsplit("/", 1)[1]
        try:
            print(f"Trying {url} …", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "austriawirtschaft-geocoder"})
            with urllib.request.urlopen(req, timeout=60) as r, open(CACHE / (name + ".part"), "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                while chunk := r.read(1 << 20):
                    f.write(chunk); done += len(chunk)
                    if total:
                        print(f"\r  {done >> 20} / {total >> 20} MB", end="", flush=True)
            print()
            (CACHE / (name + ".part")).rename(CACHE / name)
            return CACHE / name
        except Exception as e:  # 404 etc. → try the next one
            print(f"  not available ({e})")
    sys.exit("Could not download the address register. Download it manually from "
             "https://www.bev.gv.at/Services/Produkte/Adressregister.html and put the zip into ./bev/")


def open_member(z, wanted):
    """Open a CSV inside the zip as a streaming text reader (no full load into memory)."""
    names = {Path(n).name.upper(): n for n in z.namelist()}
    if wanted not in names:
        sys.exit(f"{wanted} not found in the zip. Files: {sorted(names)}")
    with z.open(names[wanted]) as f:
        head = f.read(1 << 20)
    try:
        head.decode("utf-8"); enc = "utf-8-sig"
    except UnicodeDecodeError:
        enc = "cp1252"
    first = head.split(b"\n", 1)[0].decode(enc, "replace")
    sep = ";" if first.count(";") > first.count(",") else ","
    text = io.TextIOWrapper(z.open(names[wanted]), encoding=enc, errors="replace", newline="")
    reader = csv.reader(text, delimiter=sep, quotechar='"')
    header = [c.strip().strip('"').lstrip("\ufeff").upper() for c in next(reader)]
    return reader, header


def idx(header, *options):
    for o in options:
        if o in header:
            return header.index(o)
    sys.exit(f"None of {options} found. Columns are: {header}")


def norm_street(s):
    s = unicodedata.normalize("NFC", str(s)).lower()
    s = s.replace("ß", "ss")
    s = re.sub(r"\bst\.\s*", "sankt ", s)
    s = re.sub(r"str\.?(?=\s|$)", "strasse", s)          # "Hauptstr." → "hauptstrasse"
    s = re.sub(r"\bstrasse\b", "strasse", s)
    s = re.sub(r"[^a-z0-9äöü]+", "", s)                     # drop spaces, dots, hyphens
    return s

HNR = re.compile(r"^\s*(\d+)\s*([a-zA-Z](?![a-zA-Z]))?")

def parse_hnr(s):
    m = HNR.match(str(s))
    if not m:
        return None, ""
    return m.group(1).lstrip("0") or "0", (m.group(2) or "").lower()


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python3 geocode_addresses.py justizonline_all_companies.csv.gz")
    companies = pd.read_csv(sys.argv[1], dtype=str, keep_default_na=False,
                            usecols=["fb_nummer", "street", "house_number", "plz", "staat"])
    print(f"Companies: {len(companies):,}")

    # What we need: (postcode, street) pairs that appear among the companies.
    companies["st"] = companies["street"].map(norm_street)
    need = set(zip(companies["plz"], companies["st"]))
    need_names = {st for _, st in need}

    zpath = download_register()
    with zipfile.ZipFile(zpath) as z:
        reader, h = open_member(z, "STRASSE.CSV")
        i_skz, i_name = idx(h, "SKZ"), idx(h, "STRASSENNAME")
        street_name = {}
        for row in reader:
            if len(row) > max(i_skz, i_name):
                st = norm_street(row[i_name])
                if st in need_names:
                    street_name[row[i_skz]] = st
        print(f"Streets matching company addresses: {len(street_name):,}")

        reader, h = open_member(z, "ADRESSE.CSV")
        i_skz, i_plz = idx(h, "SKZ"), idx(h, "PLZ")
        i_n1, i_b1 = idx(h, "HAUSNRZAHL1"), idx(h, "HAUSNRBUCHSTABE1")
        i_rw, i_hw, i_epsg = idx(h, "RW"), idx(h, "HW"), idx(h, "EPSG")
        top = max(i_skz, i_plz, i_n1, i_b1, i_rw, i_hw, i_epsg)
        keep = defaultdict(list)   # epsg -> [(plz, st, n1, b1, rw, hw)]
        scanned = 0
        for row in reader:
            scanned += 1
            if len(row) <= top:
                continue
            st = street_name.get(row[i_skz])
            if not st or (row[i_plz], st) not in need or not row[i_rw] or not row[i_hw]:
                continue
            try:
                rw = float(row[i_rw].replace(",", ".")); hw = float(row[i_hw].replace(",", "."))
            except ValueError:
                continue
            keep[row[i_epsg]].append((row[i_plz], st, row[i_n1].lstrip("0"), row[i_b1].lower(), rw, hw))
    print(f"Register: scanned {scanned:,} addresses, kept {sum(map(len, keep.values())):,} ({zpath.name})")

    exact, num, street = {}, {}, defaultdict(list)
    for epsg, rows in keep.items():
        t = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
        lons, lats = t.transform([r[4] for r in rows], [r[5] for r in rows])
        for (plz, st, n1, b1, _, _), lat, lon in zip(rows, lats, lons):
            exact.setdefault((plz, st, n1, b1), (lat, lon))
            num.setdefault((plz, st, n1), (lat, lon))
            street[(plz, st)].append((lat, lon))
    keep.clear()
    street_c = {k: (sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)) for k, v in street.items()}
    street.clear()

    out, stats = [], defaultdict(int)
    for r in companies.itertuples():
        lat = lon = None; prec = ""
        if r.staat == "AUT" and r.street and r.plz:
            st = r.st
            n1, b1 = parse_hnr(r.house_number)
            if n1 and (r.plz, st, n1, b1) in exact:
                (lat, lon), prec = exact[(r.plz, st, n1, b1)], "address"
            elif n1 and (r.plz, st, n1) in num:
                (lat, lon), prec = num[(r.plz, st, n1)], "address"
            elif (r.plz, st) in street_c:
                (lat, lon), prec = street_c[(r.plz, st)], "street"
        stats[prec or "none"] += 1
        out.append((r.fb_nummer, f"{lat:.6f}" if lat else "", f"{lon:.6f}" if lon else "", prec))

    with gzip.open(HERE / "geocoded.csv.gz", "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f); w.writerow(["fb_nummer", "lat", "lon", "precision"]); w.writerows(out)

    n = len(companies)
    print(f"\nExact address:  {stats['address']:>7,}  ({stats['address'] / n:.1%})")
    print(f"Street only:    {stats['street']:>7,}  ({stats['street'] / n:.1%})")
    print(f"Not matched:    {stats['none']:>7,}  ({stats['none'] / n:.1%})")
    print(f"\nSaved {HERE / 'geocoded.csv.gz'}  ← send this file in the chat")
    print(f"Source note for the site: © Österreichisches Adressregister ({zpath.stem.rsplit('_', 1)[1]})")


if __name__ == "__main__":
    main()
