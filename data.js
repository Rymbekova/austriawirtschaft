// Austrian economic data. All figures from official releases; see SOURCES below.
// Keys match the "name" property in laender.json.
window.AW_DATA = {
  states: ["Burgenland","Kärnten","Niederösterreich","Oberösterreich","Salzburg","Steiermark","Tirol","Vorarlberg","Wien"],

  // Statistik Austria, Regionale Gesamtrechnungen, press release 9 Dec 2025 (Tabelle 1 & 2)
  regional2024: {
    "Österreich":       { brpPerCapita: 53800, realGrowth: -0.7, income: 30400, jobs: 5056700, brp: 494088 },
    "Burgenland":       { brpPerCapita: 39000, realGrowth: -0.4, income: 31200, jobs: 141500,  brp: 11763 },
    "Niederösterreich": { brpPerCapita: 44500, realGrowth: -1.0, income: 31600, jobs: 830200,  brp: 76878 },
    "Wien":             { brpPerCapita: 61900, realGrowth:  0.9, income: 28200, jobs: 1190200, brp: 124867 },
    "Kärnten":          { brpPerCapita: 49600, realGrowth: -3.6, income: 30100, jobs: 293700,  brp: 28270 },
    "Steiermark":       { brpPerCapita: 50300, realGrowth:  0.1, income: 30700, jobs: 709000,  brp: 63924 },
    "Oberösterreich":   { brpPerCapita: 53800, realGrowth: -2.7, income: 30800, jobs: 854600,  brp: 82538 },
    "Salzburg":         { brpPerCapita: 65800, realGrowth: -0.5, income: 31300, jobs: 355900,  brp: 37663 },
    "Tirol":            { brpPerCapita: 57700, realGrowth:  0.1, income: 30600, jobs: 460900,  brp: 44805 },
    "Vorarlberg":       { brpPerCapita: 56500, realGrowth: -0.7, income: 31000, jobs: 219200,  brp: 23214 }
  },

  headline: {
    gdpGrowth2025: 0.7,     // real, Statistik Austria (revised Oct 2026)
    gdpNominal2025: 518.2,  // € bn
    brpPerCapita2024: 53800
  },

  sources: [
    { label: "Statistik Austria – Bruttoregionalprodukt 2024 (press release, 9 Dec 2025)", url: "https://www.statistik.at/fileadmin/announcement/2025/12/20251209Bruttoregionalprodukt2024.pdf" },
    { label: "Statistik Austria via ORF – GDP 2025 revised to +0.7%", url: "https://orf.at/stories/3443672/" },
    { label: "Companies: justizonline Firmenbuch extract (active companies)", url: "https://justizonline.gv.at" },
    { label: "Company positions: © Österreichisches Adressregister, Stichtagsdaten vom 01.04.2026 (BEV, CC BY 4.0)", url: "https://www.bev.gv.at/Services/Produkte/Adressregister.html" },
    { label: "Postcode locations: GeoNames via zauberware/postal-codes-json-xml-csv", url: "https://github.com/zauberware/postal-codes-json-xml-csv" },
    { label: "Map: GeoJSON-TopoJSON-Austria (ginseng666), based on Statistik Austria boundaries", url: "https://github.com/ginseng666/GeoJSON-TopoJSON-Austria" }
  ]
};
