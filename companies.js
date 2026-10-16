// Companies map: counts per Bundesland → Bezirk → Gemeinde → place, drilling down as you zoom.
(function () {
  const BASE = "data/companies/";
  const LAND_CODE = { "Burgenland": "1", "Kärnten": "2", "Niederösterreich": "3", "Oberösterreich": "4", "Salzburg": "5",
                      "Steiermark": "6", "Tirol": "7", "Vorarlberg": "8", "Wien": "9" };
  const LAND_LABEL = { "Niederösterreich": [48.42, 15.45], "Wien": [48.21, 16.37], "Burgenland": [47.55, 16.45] };
  const ABBR = { "Burgenland": "Bgld", "Kärnten": "Ktn", "Niederösterreich": "NÖ", "Oberösterreich": "OÖ", "Salzburg": "Sbg",
                 "Steiermark": "Stmk", "Tirol": "Tirol", "Vorarlberg": "Vbg", "Wien": "Wien" };
  const CODE_LAND = Object.fromEntries(Object.entries(LAND_CODE).map(([k, v]) => [v, k]));
  const nf = new Intl.NumberFormat("en-GB");
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isDark = () => document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;

  const el = id => document.getElementById(id);
  let S, laender, bezirke, gemeinden, places;
  const companyCache = {};
  const loadCompanies = bez => companyCache[bez] || (companyCache[bez] = fetch(`${BASE}c/${bez}.json`).then(r => r.json()));

  // ---------- map ----------
  const map = L.map("cmap", { zoomSnap: 0.25, minZoom: 5, maxZoom: 18, preferCanvas: false,
    maxBounds: [[45.6, 8.6], [49.8, 18.0]], maxBoundsViscosity: 0.8, attributionControl: true });
  map.fitBounds([[46.37, 9.53], [49.02, 17.16]]);
  map.createPane("regions").style.zIndex = 400;
  map.createPane("bubbles").style.zIndex = 600;
  map.createPane("labels").style.zIndex = 650;
  map.getPane("labels").style.pointerEvents = "none";

  // OpenStreetMap's own tiles: free, no API key; a CSS filter calms them down and makes the dark version.
  let tiles;
  function setTiles() {
    if (tiles) return;
    tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "osm-tiles",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }
  setTiles();

  const LEVELS = [
    { key: "land", max: 7.5, label: "Bundesländer" },
    { key: "bezirk", max: 9.5, label: "Bezirke" },
    { key: "gemeinde", max: 12.5, label: "Gemeinden" },
    { key: "place", max: 14.5, label: "Places" },
    { key: "address", max: 99, label: "Addresses" }
  ];
  const levels = () => S && S.geocoded ? LEVELS : LEVELS.slice(0, 4).map((l, i) => i === 3 ? { ...l, max: 99 } : l);
  const levelFor = z => levels().find(l => z <= l.max);
  const dotRenderer = L.canvas({ padding: 0.3, pane: "bubbles" });
  const bezBounds = {};
  let curLevel = null, regionLayer = null, labelLayer = L.layerGroup().addTo(map), bubbleLayer = L.layerGroup().addTo(map);
  let selected = null; // {level, id}

  // quantile breaks for the current level
  function breaks(values) {
    const v = values.filter(x => x > 0).sort((a, b) => a - b);
    if (!v.length) return [1, 2, 3, 4];
    return [0.2, 0.4, 0.6, 0.8].map(q => v[Math.floor(q * (v.length - 1))]);
  }
  let br = [];
  const fillFor = n => {
    if (!n) return "transparent";
    const i = br.findIndex(b => n <= b);
    return css(`--q${(i < 0 ? 4 : i) + 1}`);
  };

  function featuresFor(level) {
    if (level === "land") return laender;
    if (level === "bezirk") return bezirke;
    return gemeinden;
  }
  const idOf = (level, f) => level === "land" ? f.properties.name : f.properties.iso;
  const countOf = (level, f) => level === "land" ? (S.laender[f.properties.name] || 0) : f.properties.n;

  function styleFor(level, f) {
    const sel = selected && selected.level === level && selected.id === idOf(level, f);
    return { pane: "regions", color: sel ? css("--ink") : css("--surface"), weight: sel ? 2.5 : (level === "gemeinde" ? 0.6 : 1.2),
             fillColor: fillFor(countOf(level, f)), fillOpacity: 0.72, opacity: 1 };
  }

  function drawRegions(level) {
    if (regionLayer) map.removeLayer(regionLayer);
    regionLayer = null;
    if (level === "place" || level === "address") {
      // keep municipalities as faint outlines for orientation
      regionLayer = L.geoJSON(gemeinden, { pane: "regions", style: () => ({ color: css("--axis"), weight: 0.8, fill: false, interactive: false }) }).addTo(map);
      return;
    }
    const fc = featuresFor(level);
    br = breaks(fc.features.map(f => countOf(level, f)));
    regionLayer = L.geoJSON(fc, {
      style: f => styleFor(level, f),
      onEachFeature: (f, layer) => {
        layer.on("mouseover", e => { layer.setStyle({ weight: 2.5, color: css("--ink") }); layer.bringToFront(); hover(e, level, f); });
        layer.on("mousemove", e => hover(e, level, f));
        layer.on("mouseout", () => { regionLayer && regionLayer.resetStyle(layer); hideTip(); });
        layer.on("click", () => { select(level, idOf(level, f)); map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: level === "gemeinde" ? 13.5 : undefined }); });
      }
    }).addTo(map);
    drawLegend();
  }

  // ---------- labels / bubbles (only what's in view) ----------
  function labelIcon(name, n, big) {
    return L.divIcon({ className: "clabel" + (big ? " big" : ""), html: `${name ? `<span class="nm">${esc(name)}</span>` : ""}<b>${nf.format(n)}</b>`, iconSize: null });
  }
  const centerCache = new Map();
  function centerOf(level, f) {
    const k = level + idOf(level, f);
    if (!centerCache.has(k)) {
      // label inside the largest ring: bounds centre of the biggest polygon
      const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      let best = null, bestA = -1;
      polys.forEach(p => {
        const ring = p[0]; let a = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
        a = Math.abs(a);
        if (a > bestA) { bestA = a; best = ring; }
      });
      let cx = 0, cy = 0, A = 0;
      for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
        const f2 = best[j][0] * best[i][1] - best[i][0] * best[j][1];
        A += f2; cx += (best[j][0] + best[i][0]) * f2; cy += (best[j][1] + best[i][1]) * f2;
      }
      A /= 2;
      centerCache.set(k, [cy / (6 * A), cx / (6 * A)]);
    }
    return centerCache.get(k);
  }

  function drawLabels() {
    labelLayer.clearLayers(); bubbleLayer.clearLayers();
    const level = curLevel.key, b = map.getBounds().pad(0.1), z = map.getZoom();
    if (level === "address") { drawAddresses(b); return; }
    if (level === "place") {
      const vis = places.filter(p => b.contains([p[2], p[3]]));
      const max = Math.max(...vis.map(p => p[5]), 1);
      vis.sort((a, b2) => b2[5] - a[5]).forEach(p => {
        const r = 6 + 22 * Math.sqrt(p[5] / max);
        const isSel = selected && selected.level === "place" && selected.id === p[0] + "|" + p[1];
        const m = L.circleMarker([p[2], p[3]], { pane: "bubbles", radius: r, color: isSel ? css("--ink") : css("--surface"), weight: isSel ? 2.5 : 1.5,
          fillColor: css("--s1"), fillOpacity: 0.8 }).addTo(bubbleLayer);
        m.on("mousemove", e => showTip(e.originalEvent, `${p[1]}`, [["Postcode", p[0]], ["Companies", nf.format(p[5])]]));
        m.on("mouseout", hideTip);
        m.on("click", () => { select("place", p[0] + "|" + p[1]); });
        if (r >= 11) L.marker([p[2], p[3]], { icon: L.divIcon({ className: "cbubble", html: nf.format(p[5]), iconSize: null }), pane: "labels", interactive: false }).addTo(labelLayer);
      });
      return;
    }
    const fc = featuresFor(level);
    const minN = level === "gemeinde" ? (z < 11 ? 40 : z < 12 ? 10 : 0) : 0;
    fc.features.forEach(f => {
      const n = countOf(level, f);
      if (!n || n < minN) return;
      const c = (level === "land" && LAND_LABEL[f.properties.name]) || centerOf(level, f);
      if (!b.contains(c)) return;
      const narrow = map.getSize().x < 520;
      const name = level === "land" ? (narrow ? ABBR[f.properties.name] : f.properties.name) : (level === "bezirk" ? shortName(f.properties.name) : (z >= 11 ? shortName(f.properties.name) : ""));
      L.marker(c, { icon: labelIcon(name, n, level === "land"), pane: "labels", interactive: false }).addTo(labelLayer);
    });
  }
  let addrToken = 0;
  async function drawAddresses(b) {
    const token = ++addrToken;
    const want = bezirke.features.filter(f => {
      const iso = f.properties.iso;
      if (!bezBounds[iso]) bezBounds[iso] = L.geoJSON(f).getBounds();
      return f.properties.n && bezBounds[iso].intersects(b);
    }).map(f => f.properties.iso);
    const lists = await Promise.all(want.map(loadCompanies));
    if (token !== addrToken || !curLevel || curLevel.key !== "address") return;
    bubbleLayer.clearLayers();
    const s1 = css("--s1"), surf = css("--surface"), muted = css("--muted");
    const unpinned = {};
    lists.flat().forEach(r => {
      if (r.length < 11) { unpinned[r[3]] = (unpinned[r[3]] || 0) + 1; return; }
      if (!b.contains([r[9], r[10]])) return;
      const exact = r[11] === "a";
      const isSel = selected && selected.level === "company" && selected.id === r[0];
      const m = L.circleMarker([r[9], r[10]], { renderer: dotRenderer, radius: isSel ? 8 : 5, weight: isSel ? 3 : 1.5,
        color: isSel ? css("--ink") : (exact ? surf : s1), fillColor: s1, fillOpacity: exact ? 0.9 : 0.15 }).addTo(bubbleLayer);
      m.on("mousemove", e => showTip(e.originalEvent, r[1], [["Address", r[2] || "–"], ["Sector", r[5] || "–"]]));
      m.on("mouseout", hideTip);
      m.on("click", () => showCompany(r));
    });
    // companies without an exact position stay at their place, as a grey count
    Object.entries(unpinned).forEach(([pi, n]) => {
      const p = places[pi];
      if (!b.contains([p[2], p[3]])) return;
      const m = L.circleMarker([p[2], p[3]], { renderer: dotRenderer, radius: 7 + Math.min(10, Math.sqrt(n)), weight: 1.5,
        color: surf, fillColor: muted, fillOpacity: 0.75 }).addTo(bubbleLayer);
      m.on("mousemove", e => showTip(e.originalEvent, `${p[0]} ${p[1]}`, [["Without exact address", nf.format(n)]]));
      m.on("mouseout", hideTip);
      m.on("click", () => select("place", p[0] + "|" + p[1]));
    });
  }

  function showCompany(r) {
    selected = { level: "company", id: r[0] };
    const p = places[r[3]], gkz = p[4], land = CODE_LAND[gkz[0]];
    const gf = gemeinden.features.find(x => x.properties.iso === gkz);
    crumbs([{ label: "Austria", go: goAustria }, { label: land, go: goLand(land) },
            { label: shortName(gf.properties.name), go: goGem(gkz) }, { label: "Company" }]);
    el("chead").innerHTML = `<div class="cname">${esc(r[1])}</div>
      <div class="cmeta">${esc(r[2] ? r[2] + ", " : "")}${esc(p[0] + " " + p[1])}</div>`;
    const web = r[8] ? `<dt>Website</dt><dd><a href="${/^https?:/i.test(r[8]) ? esc(r[8]) : "https://" + esc(r[8])}" target="_blank" rel="noopener nofollow">${esc(r[8])}</a></dd>` : "";
    el("ccount").textContent = "";
    el("cbody").innerHTML = `<dl class="cdl">
      <dt>Legal form</dt><dd>${esc(LF[r[4]] || r[4] || "–")}</dd>
      <dt>Sector</dt><dd>${esc(r[5] || "–")}</dd>
      <dt>Activity</dt><dd>${esc(r[6] || "–")}</dd>
      <dt>Registered</dt><dd>${esc(r[7] || "–")}</dd>
      <dt>Register no.</dt><dd>FN ${esc(r[0])}</dd>${web}
      <dt>Position</dt><dd>${r[11] === "a" ? "Exact address" : "Street (house number not found)"}</dd></dl>`;
    drawLabels();
  }

  const shortName = s => s.replace(/^Wien\s*\d+\.,\s*/, "").replace(/^Wien-/, "").replace(/\(Stadt\)/, "").replace(/-Land$/, " Land").trim();

  function hover(e, level, f) {
    const n = countOf(level, f);
    const parent = level === "land" ? null : CODE_LAND[f.properties.iso[0]];
    showTip(e.originalEvent, f.properties.name.replace(/\s+/g, " "), [["Companies", nf.format(n)], ...(parent ? [["Bundesland", parent]] : [])]);
  }

  // ---------- tooltip (shared with the page) ----------
  const tip = el("tip");
  function showTip(evt, title, rows) {
    tip.innerHTML = `<div class="t">${esc(title)}</div>` + rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    tip.style.opacity = 1;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + w > innerWidth - 8) x = evt.clientX - w - 14;
    if (y + h > innerHeight - 8) y = evt.clientY - h - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => tip.style.opacity = 0;

  // ---------- legend + level indicator ----------
  function drawLegend() {
    const lv = curLevel;
    const steps = el("clevels");
    steps.innerHTML = levels().map(l => `<span class="${l.key === lv.key ? "on" : ""}">${l.label}</span>`).join('<span class="sep">›</span>');
    if (lv.key === "address") {
      el("clegend").innerHTML = `<span class="dot"></span> Company at its exact address <span class="dot hollow"></span> Street found, house number not <span class="dot grey"></span> Address not found (shown at its place)`;
      return;
    }
    if (lv.key === "place") {
      el("clegend").innerHTML = `<span class="dot"></span> Circle size = number of companies registered at that postcode and place`;
      return;
    }
    const lo = br[0], sw = [1, 2, 3, 4, 5].map(i => `<span style="background:${css(`--q${i}`)}"></span>`).join("");
    const lbl = ["≤ " + nf.format(br[0]), "", "", "", "> " + nf.format(br[3])];
    el("clegend").innerHTML = `<span>Fewer</span><span class="sw">${sw}</span><span>More companies</span>
      <span class="mutedtxt">${nf.format(br[0])} · ${nf.format(br[1])} · ${nf.format(br[2])} · ${nf.format(br[3])} (class breaks)</span>`;
  }

  function onZoom() {
    const lv = levelFor(map.getZoom());
    if (!curLevel || lv.key !== curLevel.key) { curLevel = lv; drawRegions(lv.key); drawLegend(); }
    drawLabels();
  }

  // ---------- panel ----------
  const LF = { GES: "GmbH", EU: "e.U.", KG: "KG", OG: "OG", GEN: "Genossenschaft", FLEX: "FlexCo", AG: "AG" };
  let listState = null;

  function crumbs(parts) {
    el("ccrumbs").innerHTML = parts.map((p, i) => i === parts.length - 1 ? `<span>${esc(p.label)}</span>` :
      `<a href="#" data-i="${i}">${esc(p.label)}</a>`).join(" › ");
    el("ccrumbs").querySelectorAll("a").forEach(a => a.onclick = e => { e.preventDefault(); parts[+a.dataset.i].go(); });
  }
  const goAustria = () => { selected = null; map.fitBounds([[46.37, 9.53], [49.02, 17.16]]); panelAustria(); };
  const goLand = name => () => { const f = laender.features.find(x => x.properties.name === name); select("land", name); map.fitBounds(L.geoJSON(f).getBounds()); };
  const goBez = iso => () => { const f = bezirke.features.find(x => x.properties.iso === iso); select("bezirk", iso); map.fitBounds(L.geoJSON(f).getBounds()); };
  const goGem = iso => () => { const f = gemeinden.features.find(x => x.properties.iso === iso); select("gemeinde", iso); map.fitBounds(L.geoJSON(f).getBounds(), { maxZoom: 13.5 }); };

  function sectorBars(list, total) {
    const max = Math.max(...list.map(x => x[1]), 1);
    return `<div class="cs-h">Top sectors</div><ul class="secs">` + list.map(([s, n]) =>
      `<li><span class="sn">${esc(s)}</span><span class="sb"><i style="width:${n / max * 100}%"></i></span><span class="sv">${nf.format(n)}</span></li>`).join("") + "</ul>";
  }
  function topSectors(rows) {
    const c = {}; rows.forEach(r => { if (r[5]) c[r[5]] = (c[r[5]] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }
  function head(name, n, extra, whole) {
    const share = n / S.placed * 100;
    const meta = whole ? "companies with an Austrian address" :
      `companies · ${share < 0.1 ? "<0.1" : share.toFixed(1)}% of Austria${extra ? " · " + extra : ""}`;
    el("chead").innerHTML = `<div class="cname">${esc(name)}</div><div class="cnum">${nf.format(n)}</div><div class="cmeta">${meta}</div>`;
  }

  function panelAustria() {
    crumbs([{ label: "Austria" }]);
    head("Austria", S.placed, "", true);
    el("cbody").innerHTML = sectorBars(S.sectors.slice(0, 6)) + `<p class="hint">Zoom in or click a state to drill down to districts, municipalities, places and individual company addresses.</p>`;
    restyle();
  }

  async function select(level, id) {
    selected = { level, id };
    restyle();
    if (level === "land") {
      crumbs([{ label: "Austria", go: goAustria }, { label: id }]);
      const d = S.landDetail[id];
      head(id, d.n, `${bezirke.features.filter(f => f.properties.iso[0] === LAND_CODE[id]).length} districts`);
      el("cbody").innerHTML = sectorBars(d.sectors) + `<p class="hint">Click a district on the map to see its municipalities.</p>`;
      return;
    }
    if (level === "bezirk") {
      const f = bezirke.features.find(x => x.properties.iso === id);
      const land = CODE_LAND[id[0]];
      crumbs([{ label: "Austria", go: goAustria }, { label: land, go: goLand(land) }, { label: shortName(f.properties.name) }]);
      head(f.properties.name, f.properties.n, land);
      el("cbody").innerHTML = `<p class="hint">Loading…</p>`;
      const rows = await loadCompanies(id);
      if (!selected || selected.id !== id) return;
      const gems = gemeinden.features.filter(g => g.properties.iso.slice(0, 3) === id).sort((a, b) => b.properties.n - a.properties.n);
      el("cbody").innerHTML = sectorBars(topSectors(rows)) +
        `<div class="cs-h">Municipalities</div><ul class="gems">` + gems.slice(0, 12).map(g =>
          `<li><a href="#" data-iso="${g.properties.iso}">${esc(shortName(g.properties.name))}</a><span>${nf.format(g.properties.n)}</span></li>`).join("") + "</ul>" +
        (gems.length > 12 ? `<p class="hint">+ ${gems.length - 12} more — zoom in to see them.</p>` : "");
      el("cbody").querySelectorAll("a[data-iso]").forEach(a => a.onclick = e => { e.preventDefault(); goGem(a.dataset.iso)(); });
      return;
    }
    if (level === "gemeinde" || level === "place") {
      let gkz, title, n, filter;
      if (level === "gemeinde") {
        const f = gemeinden.features.find(x => x.properties.iso === id);
        gkz = id; title = f.properties.name; n = f.properties.n;
        const ids = new Set(places.map((p, i) => p[4] === id ? i : -1).filter(i => i >= 0));
        filter = r => ids.has(r[3]);
      } else {
        const [plz, ort] = id.split("|");
        const pi = places.findIndex(p => p[0] === plz && p[1] === ort);
        const p = places[pi];
        gkz = p[4]; title = `${plz} ${ort}`; n = p[5];
        filter = r => r[3] === pi;
      }
      const bez = gkz.slice(0, 3), land = CODE_LAND[gkz[0]];
      const bf = bezirke.features.find(x => x.properties.iso === bez);
      const gf = gemeinden.features.find(x => x.properties.iso === gkz);
      const parts = [{ label: "Austria", go: goAustria }, { label: land, go: goLand(land) }];
      if (bf && land !== "Wien") parts.push({ label: shortName(bf.properties.name), go: goBez(bez) });
      if (level === "place" && (!bf || shortName(gf.properties.name) !== shortName(bf.properties.name) || land === "Wien"))
        parts.push({ label: shortName(gf.properties.name), go: goGem(gkz) });
      parts.push({ label: level === "place" ? title : shortName(title) });
      crumbs(parts);
      head(title, n, level === "place" ? shortName(gf.properties.name) : (bf ? shortName(bf.properties.name) : land));
      el("cbody").innerHTML = `<p class="hint">Loading…</p>`;
      const rows = (await loadCompanies(bez)).filter(filter);
      if (!selected || selected.id !== id) return;
      listState = { rows, q: "", shown: 50 };
      el("cbody").innerHTML = sectorBars(topSectors(rows)) +
        `<div class="cs-h">Companies</div>
         <input class="csearch" id="csearch" type="search" placeholder="Search by name, street or sector" aria-label="Search companies">
         <ul class="clist" id="clist"></ul><button class="tab" id="cmore" type="button" style="margin-top:8px">Show more</button>`;
      el("csearch").oninput = e => { listState.q = e.target.value.toLowerCase(); listState.shown = 50; drawList(); };
      el("cmore").onclick = () => { listState.shown += 100; drawList(); };
      drawList();
    }
  }

  function drawList() {
    const { rows, q, shown } = listState;
    const hits = q ? rows.filter(r => (r[1] + " " + r[2] + " " + r[5] + " " + r[6]).toLowerCase().includes(q)) : rows;
    el("clist").innerHTML = hits.slice(0, shown).map(r => {
      const p = places[r[3]];
      const web = r[8] ? ` · <a href="${/^https?:/i.test(r[8]) ? esc(r[8]) : "https://" + esc(r[8])}" target="_blank" rel="noopener nofollow">website</a>` : "";
      return `<li data-fb="${esc(r[0])}"><div class="cn">${r.length > 10 ? `<a href="#">${esc(r[1])}</a>` : esc(r[1])}</div><div class="ca">${esc(r[2] ? r[2] + ", " : "")}${esc(p[0] + " " + p[1])}</div>
        <div class="ct">${esc(LF[r[4]] || r[4] || "")}${r[6] ? " · " + esc(r[6]) : ""}${r[7] ? " · since " + r[7] : ""}${web}</div></li>`;
    }).join("") || `<li class="hint">No matches.</li>`;
    el("cmore").style.display = hits.length > shown ? "" : "none";
    el("clist").querySelectorAll("li[data-fb] a[href='#']").forEach(a => a.onclick = e => {
      e.preventDefault();
      const r = rows.find(x => x[0] === a.closest("li").dataset.fb);
      map.setView([r[9], r[10]], 17); setTimeout(() => showCompany(r), 400);
    });
    el("ccount").textContent = q ? `${nf.format(hits.length)} of ${nf.format(rows.length)} shown by search` : "";
  }

  function restyle() {
    if (regionLayer && curLevel && !["place", "address"].includes(curLevel.key)) regionLayer.setStyle(f => styleFor(curLevel.key, f));
    if (curLevel && ["place", "address"].includes(curLevel.key)) drawLabels();
  }

  // ---------- tiles ----------
  function renderTiles() {
    el("ctiles").innerHTML = [
      ["Active companies", nf.format(S.total), "In the commercial register extract"],
      ["At their exact address", (S.geocodedExact / S.total * 100).toFixed(0) + "%", `${nf.format(S.geocodedExact)} companies pinned to the building`],
      ["Largest sector", S.sectors[0][0], `${nf.format(S.sectors[0][1])} companies`],
      ["Most common legal form", "GmbH", `${(S.legalForms[0][1] / S.placed * 100).toFixed(0)}% of companies`]
    ].map(([k, v, n]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="n">${esc(n)}</div></div>`).join("");
  }

  // ---------- boot ----------
  Promise.all([
    fetch(BASE + "summary.json").then(r => r.json()),
    fetch("laender.json").then(r => r.json()),
    fetch(BASE + "bezirke.json").then(r => r.json()),
    fetch(BASE + "gemeinden.json").then(r => r.json()),
    fetch(BASE + "places.json").then(r => r.json())
  ]).then(([s, l, b, g, p]) => {
    S = s; laender = l; bezirke = b; gemeinden = g; places = p;
    renderTiles(); panelAustria();
    map.on("zoomstart movestart", hideTip);
    map.on("zoomend", onZoom); map.on("moveend", drawLabels);
    onZoom();
  }).catch(err => { el("cbody").innerHTML = `<p class="hint">The company data could not be loaded.</p>`; console.error(err); });

  // react to theme changes
  const reTheme = () => { setTiles(); if (curLevel) { drawRegions(curLevel.key); drawLabels(); } };
  el("themeBtn").addEventListener("click", () => setTimeout(reTheme, 0));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reTheme);
})();
