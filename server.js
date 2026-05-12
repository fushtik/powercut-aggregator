#!/usr/bin/env node

const http = require('http');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const PORT = process.env.SERVER_PORT || 3000;

const SCRAPER_ORDER = ['UKPN', 'SSEN', 'Northern Powergrid', 'SPE', 'NGED', 'NIE', 'ENWL'];

async function getScraperHealth() {
  const { data, error } = await supabase
    .from('scraper_health')
    .select('scraper,last_run,status,records_upserted,duration_ms,error_message');
  if (error) throw error;
  return data || [];
}

async function getOutages() {
  const { data, error } = await supabase
    .from('outages')
    .select('dno,outage_type,affected_postcode_area,customers_affected,lat,lon,start_time,estimated_restoration_time,cause,fault_description,status,location_description,reference_number')
    .eq('status', 'active')
    .order('customers_affected', { ascending: false });
  if (error) throw error;
  return data;
}

const DNO_COLORS = {
  'UKPN':               '#1565C0',
  'SSEN':               '#2E7D32',
  'Northern Powergrid': '#E65100',
  'SPE':                '#C62828',
  'NGED':               '#6A1B9A',
  'NIE':                '#00838F',
  'ENWL':               '#F57F17',
};

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UK Power Cut Aggregator</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; height: 100vh; display: flex; flex-direction: column; }

    #header {
      background: #16213e;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #0f3460;
      flex-shrink: 0;
    }
    #header h1 { font-size: 1.2rem; font-weight: 600; color: #e94560; letter-spacing: 0.5px; }
    #header .subtitle { font-size: 0.8rem; color: #888; margin-top: 2px; }

    #stats {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .stat-chip {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      color: #fff;
    }
    #total-chip {
      background: #444;
      font-size: 0.8rem;
      padding: 4px 12px;
    }
    #filter-toggle {
      display: flex;
      align-items: center;
      gap: 0;
      border: 1px solid #0f3460;
      border-radius: 8px;
      overflow: hidden;
      font-size: 0.75rem;
      flex-shrink: 0;
    }
    .filter-btn {
      padding: 5px 12px;
      background: transparent;
      color: #888;
      border: none;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      transition: background 0.15s, color 0.15s;
    }
    .filter-btn.active {
      background: #0f3460;
      color: #fff;
    }

    #map { flex: 1; }

    #legend {
      position: absolute;
      bottom: 30px;
      right: 10px;
      background: rgba(22,33,62,0.95);
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 10px 14px;
      z-index: 1000;
      font-size: 0.75rem;
      min-width: 160px;
    }
    #legend h4 { font-size: 0.75rem; color: #aaa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .legend-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .legend-label { color: #ddd; }
    .legend-divider { border: none; border-top: 1px solid #333; margin: 8px 0; }
    .legend-size-row { display: flex; align-items: center; gap: 6px; color: #aaa; font-size: 0.7rem; }
    .legend-circle { border-radius: 50%; background: #666; display: inline-block; }

    .loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #aaa; font-size: 1rem; z-index: 999; }

    #footer {
      background: #16213e;
      border-top: 1px solid #0f3460;
      padding: 6px 16px;
      font-size: 0.68rem;
      color: #999;
      text-align: center;
      flex-shrink: 0;
      line-height: 1.5;
    }
    #footer a { color: #888; text-decoration: none; }
    #footer a:hover { color: #bbb; }

    .leaflet-popup-content-wrapper { background: #16213e; color: #eee; border: 1px solid #0f3460; border-radius: 8px; }
    .leaflet-popup-tip { background: #16213e; }
    .leaflet-popup-content { margin: 12px 16px; font-size: 0.82rem; line-height: 1.6; min-width: 220px; }
    .popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .popup-dno { font-weight: 700; font-size: 0.95rem; }
    .popup-divider { border: none; border-top: 1px solid #2a3a5c; margin: 6px 0; }
    .popup-row { display: flex; justify-content: space-between; gap: 16px; }
    .popup-label { color: #888; flex-shrink: 0; }
    .popup-ref { font-size: 0.68rem; color: #666; margin-top: 6px; }
    .popup-badge { display: inline-block; padding: 1px 7px; border-radius: 8px; font-size: 0.7rem; font-weight: 600; }
    .badge-unplanned { background: #c62828; color: #fff; }
    .badge-planned { background: #e65100; color: #fff; }
    .popup-approx { font-size: 0.68rem; color: #888; margin-top: 4px; font-style: italic; }

    /* Nav menu */
    #nav-menu { display: flex; gap: 4px; }
    .nav-btn {
      padding: 5px 12px;
      background: transparent;
      color: #888;
      border: 1px solid #0f3460;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .nav-btn:hover { background: #0f3460; color: #fff; }

    /* Slide-in panel */
    #panel-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 2000;
    }
    #panel-overlay.open { display: block; }
    #panel {
      position: fixed;
      top: 0; right: -480px;
      width: 460px;
      max-width: 100vw;
      height: 100vh;
      background: #16213e;
      border-left: 2px solid #0f3460;
      z-index: 2001;
      display: flex;
      flex-direction: column;
      transition: right 0.25s ease;
      overflow: hidden;
    }
    #panel.open { right: 0; }
    #panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #0f3460;
      flex-shrink: 0;
    }
    #panel-title { font-size: 1rem; font-weight: 700; color: #e94560; }
    #panel-close {
      background: none; border: none; color: #888; font-size: 1.4rem;
      cursor: pointer; line-height: 1; padding: 0 4px;
    }
    #panel-close:hover { color: #fff; }
    #panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      font-size: 0.85rem;
      line-height: 1.7;
      color: #ccc;
    }
    #panel-body h3 { color: #e94560; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px; }
    #panel-body h3:first-child { margin-top: 0; }
    #panel-body p { margin-bottom: 10px; color: #bbb; }
    #panel-body a { color: #6ab0f5; text-decoration: none; }
    #panel-body a:hover { text-decoration: underline; }

    /* Coverage table */
    .dno-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 0.8rem; }
    .dno-table th { text-align: left; color: #888; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #0f3460; font-size: 0.72rem; text-transform: uppercase; }
    .dno-table td { padding: 8px 8px; border-bottom: 1px solid #1a2a4a; vertical-align: top; }
    .dno-table tr:last-child td { border-bottom: none; }
    .dno-name { font-weight: 700; }
    .dno-link { font-size: 0.72rem; display: block; margin-top: 2px; }
  </style>
</head>
<body>

<div id="header">
  <div>
    <h1>UK Power Cut Aggregator</h1>
    <div class="subtitle">Live active outages from 7 DNOs</div>
  </div>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div id="filter-toggle">
      <button class="filter-btn active" id="btn-unplanned" onclick="setFilter('unplanned')">Unplanned</button>
      <button class="filter-btn" id="btn-all" onclick="setFilter('all')">All</button>
    </div>
    <div id="stats">
      <span id="total-chip" class="stat-chip">Loading...</span>
    </div>
    <div id="nav-menu">
      <button class="nav-btn" onclick="openPanel('coverage')">Coverage</button>
      <button class="nav-btn" onclick="openPanel('how')">How it works</button>
      <button class="nav-btn" onclick="openPanel('about')">About</button>
    </div>
  </div>
</div>

<div id="panel-overlay" onclick="closePanel()"></div>
<div id="panel">
  <div id="panel-header">
    <span id="panel-title"></span>
    <button id="panel-close" onclick="closePanel()">&#x2715;</button>
  </div>
  <div id="panel-body"></div>
</div>

<div id="map"><div class="loading">Loading outages...</div></div>

<div id="footer">
  Outage data sourced from UK Distribution Network Operators and remains the property of the respective DNO.
  &nbsp;&middot;&nbsp;
  This is an unofficial personal project, not affiliated with or endorsed by any DNO or industry body.
  &nbsp;&middot;&nbsp;
  Data is aggregated from public sources for convenience only &mdash; always check your DNO&rsquo;s website for the latest information.
</div>

<div id="legend">
  <h4>DNO</h4>
  <div class="legend-row"><span class="legend-dot" style="background:#1565C0"></span><span class="legend-label">UKPN</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#2E7D32"></span><span class="legend-label">SSEN</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#E65100"></span><span class="legend-label">Northern Powergrid</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#C62828"></span><span class="legend-label">SP Energy</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#6A1B9A"></span><span class="legend-label">NGED</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#00838F"></span><span class="legend-label">NIE</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#F57F17"></span><span class="legend-label">ENWL</span></div>
  <hr class="legend-divider">
  <h4>Customers affected</h4>
  <div class="legend-size-row">
    <span class="legend-circle" style="width:8px;height:8px"></span> &lt;10
    <span class="legend-circle" style="width:12px;height:12px"></span> ~50
    <span class="legend-circle" style="width:18px;height:18px"></span> 100+
  </div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const DNO_COLORS = ${JSON.stringify(DNO_COLORS)};

// Approximate centroids for UK postcode areas — fallback when exact coords unavailable
const POSTCODE_CENTROIDS = {
  AB:[57.14,-2.11], AL:[51.75,-0.34], B:[52.48,-1.90], BA:[51.38,-2.36],
  BB:[53.75,-2.48], BD:[53.79,-1.75], BH:[50.72,-1.90], BL:[53.58,-2.43],
  BN:[50.83,-0.14], BR:[51.39, 0.02], BS:[51.46,-2.60], BT:[54.60,-6.30],
  CA:[54.90,-2.93], CB:[52.20, 0.12], CF:[51.48,-3.18], CH:[53.20,-2.89],
  CM:[51.74, 0.47], CO:[51.89, 0.90], CR:[51.38,-0.10], CT:[51.28, 1.08],
  CV:[52.41,-1.51], CW:[53.09,-2.44], DA:[51.44, 0.22], DD:[56.46,-2.97],
  DE:[52.92,-1.48], DG:[55.08,-3.61], DH:[54.78,-1.57], DL:[54.52,-1.73],
  DN:[53.52,-1.13], DT:[50.73,-2.44], DY:[52.51,-2.09], E:[51.52,-0.03],
  EC:[51.52,-0.10], EH:[55.95,-3.19], EN:[51.66,-0.08], EX:[50.72,-3.53],
  FK:[56.00,-3.78], FY:[53.83,-3.05], G:[55.86,-4.25],  GL:[51.87,-2.24],
  GU:[51.24,-0.74], HA:[51.58,-0.34], HD:[53.65,-1.78], HG:[54.00,-1.54],
  HP:[51.76,-0.71], HR:[52.06,-2.72], HS:[57.90,-6.80], HU:[53.74,-0.34],
  HX:[53.72,-1.86], IG:[51.55, 0.07], IP:[52.06, 1.16], IV:[57.49,-4.23],
  KA:[55.62,-4.50], KT:[51.37,-0.31], KW:[58.44,-3.10], KY:[56.20,-3.15],
  L:[53.41,-2.98],  LA:[54.05,-2.80], LD:[52.24,-3.45], LE:[52.64,-1.13],
  LL:[53.15,-3.80], LN:[53.23,-0.54], LS:[53.80,-1.55], LU:[51.88,-0.42],
  M:[53.48,-2.24],  ME:[51.27, 0.52], MK:[52.04,-0.76], ML:[55.78,-3.98],
  N:[51.57,-0.12],  NE:[54.97,-1.62], NG:[52.95,-1.14], NN:[52.24,-0.90],
  NP:[51.59,-2.99], NR:[52.63, 1.30], NW:[51.55,-0.17], OL:[53.54,-2.12],
  OX:[51.75,-1.26], PA:[55.84,-4.67], PE:[52.57,-0.24], PH:[56.39,-3.44],
  PL:[50.37,-4.14], PO:[50.82,-1.09], PR:[53.76,-2.70], RG:[51.45,-0.97],
  RH:[51.20,-0.20], RM:[51.56, 0.18], S:[53.38,-1.47],  SA:[51.62,-3.94],
  SE:[51.49,-0.06], SG:[51.90,-0.21], SK:[53.41,-2.16], SL:[51.51,-0.60],
  SM:[51.40,-0.19], SN:[51.56,-1.78], SO:[50.91,-1.40], SP:[51.07,-1.79],
  SR:[54.90,-1.38], SS:[51.57, 0.71], ST:[52.99,-2.12], SW:[51.47,-0.15],
  SY:[52.71,-2.75], TA:[51.02,-3.10], TD:[55.60,-2.47], TF:[52.68,-2.48],
  TN:[51.07, 0.26], TQ:[50.46,-3.53], TR:[50.26,-5.05], TS:[54.57,-1.24],
  TW:[51.45,-0.33], UB:[51.54,-0.47], W:[51.51,-0.20],  WA:[53.39,-2.59],
  WC:[51.52,-0.12], WD:[51.66,-0.42], WF:[53.68,-1.50], WN:[53.54,-2.63],
  WR:[52.19,-2.22], WS:[52.59,-1.98], WV:[52.59,-2.13], YO:[53.96,-1.08],
  ZE:[60.15,-1.15],
};

function resolveCoords(outage) {
  if (outage.lat && outage.lon) return { lat: outage.lat, lon: outage.lon, approximate: false };
  const area = (outage.affected_postcode_area || '').trim().replace(/\\d.*$/, '').toUpperCase();
  if (POSTCODE_CENTROIDS[area]) return { lat: POSTCODE_CENTROIDS[area][0], lon: POSTCODE_CENTROIDS[area][1], approximate: true };
  return null;
}

function markerRadius(customers) {
  if (!customers || customers === 0) return 5;
  return Math.max(5, Math.min(30, Math.sqrt(customers) * 1.2));
}

function formatTime(iso) {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return \`\${mins}m ago\`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? \`\${hrs}h \${rem}m ago\` : \`\${hrs}h ago\`;
}

const map = L.map('map', { zoomControl: true }).setView([54.5, -3.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 18,
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

let currentFilter = 'unplanned';

function setFilter(filter) {
  currentFilter = filter;
  document.getElementById('btn-unplanned').classList.toggle('active', filter === 'unplanned');
  document.getElementById('btn-all').classList.toggle('active', filter === 'all');
  loadOutages();
}

let cachedOutages = null;

function loadOutages() {
const doRender = (outages) => {
    cachedOutages = outages;
    const filtered = currentFilter === 'unplanned'
      ? outages.filter(o => o.outage_type === 'unplanned')
      : outages;

    markersLayer.clearLayers();
    const dnoCounts = {};
    let totalCustomers = 0;
    let plotted = 0;

    filtered.forEach(outage => {
      const coords = resolveCoords(outage);
      if (!coords) return;

      const color = DNO_COLORS[outage.dno] || '#666';
      const radius = markerRadius(outage.customers_affected);
      const badgeClass = outage.outage_type === 'planned' ? 'badge-planned' : 'badge-unplanned';

      const marker = L.circleMarker([coords.lat, coords.lon], {
        radius,
        fillColor: color,
        color: '#fff',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: coords.approximate ? 0.55 : 0.80,
      }).addTo(markersLayer);

      const etr = outage.estimated_restoration_time ? formatTime(outage.estimated_restoration_time) : 'Unknown';
      const customers = outage.customers_affected > 0 ? outage.customers_affected.toLocaleString() : '<10';

      const started = outage.start_time ? formatTime(outage.start_time) : null;
      const elapsed = outage.start_time ? timeSince(outage.start_time) : '';
      const elapsedHtml = elapsed ? \` <span style="color:#888;font-size:0.75em">(\${elapsed})</span>\` : '';
      const cause = (outage.cause || '').replace(/^(LV |HV |PSI )/i, '').trim();
      const desc = (outage.fault_description || '')
        .replace(/^(ENWL|NGED|Northern Powergrid|UKPN|SSEN|SPE|NIE):\s*/i, '')
        .replace(/Loading outages.*/gi, '')
        .replace(/Estimated time to restore:.*/gi, '')
        .replace(/Restored:.*/gi, '')
        .trim();
      const showDesc = desc && desc.toLowerCase() !== cause.toLowerCase() && desc.length < 120;
      const ref = outage.reference_number || '';

      marker.bindPopup(\`
        <div class="popup-header">
          <span class="popup-dno" style="color:\${color}">\${outage.dno}</span>
          <span class="popup-badge \${badgeClass}">\${outage.outage_type}</span>
        </div>
        <hr class="popup-divider">
        <div class="popup-row">
          <span class="popup-label">Location</span>
          <span>\${outage.location_description || outage.affected_postcode_area || '—'}</span>
        </div>
        \${started ? \`<div class="popup-row">
          <span class="popup-label">Started</span>
          <span>\${started}\${elapsedHtml}</span>
        </div>\` : ''}
        <div class="popup-row">
          <span class="popup-label">Customers</span>
          <span>\${customers}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">ETR</span>
          <span>\${etr}</span>
        </div>
        \${cause ? \`<div class="popup-row">
          <span class="popup-label">Cause</span>
          <span>\${cause}</span>
        </div>\` : ''}
        \${showDesc ? \`<div class="popup-row">
          <span class="popup-label">Info</span>
          <span style="color:#bbb">\${desc}</span>
        </div>\` : ''}
        \${ref ? \`<div class="popup-ref">Ref: \${ref}</div>\` : ''}
        \${coords.approximate ? '<div class="popup-approx">⚠ Position approximate (postcode area centroid)</div>' : ''}
      \`);

      dnoCounts[outage.dno] = (dnoCounts[outage.dno] || 0) + 1;
      totalCustomers += outage.customers_affected || 0;
      plotted++;
    });

    // Update header stats
    const statsEl = document.getElementById('stats');
    const colors = ${JSON.stringify(DNO_COLORS)};
    let html = \`<span id="total-chip" class="stat-chip">\${plotted} active outages</span>\`;
    Object.entries(dnoCounts).sort((a,b) => b[1]-a[1]).forEach(([dno, count]) => {
      const col = colors[dno] || '#666';
      html += \`<span class="stat-chip" style="background:\${col}">\${dno}: \${count}</span>\`;
    });
    statsEl.innerHTML = html;
};

if (cachedOutages) {
    doRender(cachedOutages);
  } else {
    fetch('/api/outages')
      .then(r => r.json())
      .then(doRender)
      .catch(err => {
        document.querySelector('.loading') && (document.querySelector('.loading').textContent = 'Failed to load outages');
        console.error(err);
      });
  }
}

function refreshOutages() {
  cachedOutages = null;
  loadOutages();
}

loadOutages();
setInterval(refreshOutages, 5 * 60 * 1000);

const PANEL_CONTENT = {
  coverage: {
    title: 'Coverage',
    html: '<p>This site aggregates live outage data from all seven electricity Distribution Network Operators (DNOs) covering the UK and Northern Ireland.</p>' +
      '<table class="dno-table"><thead><tr><th>DNO</th><th>Area covered</th></tr></thead><tbody>' +
      '<tr><td><span class="dno-name" style="color:#1565C0">UKPN</span>' +
        '<a class="dno-link" href="https://www.ukpowernetworks.co.uk/power-cuts/current" target="_blank" rel="noopener">UK Power Networks &#x2197;</a></td>' +
        '<td>London, South East &amp; East of England</td></tr>' +
      '<tr><td><span class="dno-name" style="color:#2E7D32">SSEN</span>' +
        '<a class="dno-link" href="https://www.ssen.co.uk/power-cuts-and-outages/" target="_blank" rel="noopener">Scottish &amp; Southern Energy Networks &#x2197;</a></td>' +
        '<td>South England &amp; North Scotland</td></tr>' +
      '<tr><td><span class="dno-name" style="color:#E65100">Northern Powergrid</span>' +
        '<a class="dno-link" href="https://www.northernpowergrid.com/power-cuts" target="_blank" rel="noopener">Northern Powergrid &#x2197;</a></td>' +
        '<td>North East England &amp; Yorkshire</td></tr>' +
      '<tr><td><span class="dno-name" style="color:#C62828">SPE</span>' +
        '<a class="dno-link" href="https://powercuts.spenergynetworks.co.uk/list" target="_blank" rel="noopener">SP Energy Networks &#x2197;</a></td>' +
        '<td>Central &amp; South Scotland, North West Wales</td></tr>' +
      '<tr><td><span class="dno-name" style="color:#6A1B9A">NGED</span>' +
        '<a class="dno-link" href="https://powercuts.nationalgrid.co.uk/" target="_blank" rel="noopener">National Grid Electricity Distribution &#x2197;</a></td>' +
        '<td>Midlands, South West England &amp; South Wales</td></tr>' +
      '<tr><td><span class="dno-name" style="color:#00838F">NIE</span>' +
        '<a class="dno-link" href="https://powercheck.nienetworks.co.uk/" target="_blank" rel="noopener">NIE Networks &#x2197;</a></td>' +
        '<td>Northern Ireland</td></tr>' +
      '<tr><td><span class="dno-name" style="color:#F57F17">ENWL</span>' +
        '<a class="dno-link" href="https://www.enwl.co.uk/power-cuts/" target="_blank" rel="noopener">Electricity North West &#x2197;</a></td>' +
        '<td>North West England</td></tr>' +
      '</tbody></table>' +
      '<p style="margin-top:14px;font-size:0.78rem;color:#777">Data sourced from each DNO&rsquo;s public API or website. Always check your DNO&rsquo;s site for the most accurate information.</p>'
  },
  how: {
    title: 'How it works',
    html: '<h3>Data collection</h3>' +
      '<p>Each DNO publishes outage data through a public API or website. Automated scrapers fetch this data every 20 minutes and store it in a central database.</p>' +
      '<h3>Data freshness</h3>' +
      '<p>The map refreshes every 5 minutes. Outages that disappear from a DNO&rsquo;s feed are automatically marked as resolved and removed after 24 hours.</p>' +
      '<h3>Coordinates</h3>' +
      '<p>Where a DNO provides precise coordinates, the marker is placed accurately. Where only a postcode is available, the marker is placed at the postcode area centroid and shown at reduced opacity &mdash; these positions are approximate.</p>' +
      '<h3>Planned vs unplanned</h3>' +
      '<p>Use the <strong>Unplanned / All</strong> toggle to switch between emergency faults only, or all outages including scheduled maintenance works.</p>' +
      '<h3>Marker size</h3>' +
      '<p>Marker size scales with the number of customers affected. Larger circles indicate more homes and businesses without power.</p>'
  },
  about: {
    title: 'About',
    html: '<p>Built by <strong>Mark Haworth G4EID/KM8H</strong>.</p>' +
      '<p><a href="https://g4eid-km8h.net" target="_blank" rel="noopener">g4eid-km8h.net &#x2197;</a></p>' +
      '<p>An unofficial personal project aggregating publicly available outage data from all UK electricity Distribution Network Operators into a single map view.</p>' +
      '<p>Not affiliated with or endorsed by any DNO or industry body.</p>' +
      '<p style="margin-top:16px;font-size:0.78rem;color:#777">This site was developed with the assistance of AI (Claude by Anthropic).</p>'
  }
};

function openPanel(name) {
  const content = PANEL_CONTENT[name];
  if (!content) return;
  document.getElementById('panel-title').textContent = content.title;
  document.getElementById('panel-body').innerHTML = content.html;
  document.getElementById('panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('open');
}
</script>
</body>
</html>`;

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "img-src 'self' data: https://*.tile.openstreetmap.org; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
}

// Simple in-memory rate limiter for /api/outages
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30;
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count > maxRequests;
}
// Prune stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 1000;
  for (const [ip, entry] of rateLimitMap) {
    if (entry.start < cutoff) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];

  if (path === '/status') {
    try {
      const rows = await getScraperHealth();
      const healthMap = Object.fromEntries(rows.map(r => [r.scraper, r]));
      const now = Date.now();

      function timeAgo(iso) {
        const mins = Math.floor((now - new Date(iso)) / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
      }

      const rows_html = SCRAPER_ORDER.map(name => {
        const h = healthMap[name];
        if (!h) {
          return `<tr><td style="color:#888">${name}</td><td colspan="4" style="color:#555">No data yet</td></tr>`;
        }
        const ok = h.status === 'success';
        const statusCell = ok
          ? '<td><span style="color:#2E7D32;font-weight:700">✅ OK</span></td>'
          : '<td><span style="color:#c62828;font-weight:700">❌ Failed</span></td>';
        const ago = timeAgo(h.last_run);
        const lastRun = new Date(h.last_run).toLocaleString('en-GB', { day:'numeric',month:'short',hour:'2-digit',minute:'2-digit' });
        const dur = `${(h.duration_ms / 1000).toFixed(1)}s`;
        const errorCell = h.error_message
          ? `<td style="color:#e57373;font-size:0.78rem">${h.error_message.substring(0, 80)}</td>`
          : '<td style="color:#555">—</td>';
        return `<tr>
          <td style="font-weight:600">${name}</td>
          ${statusCell}
          <td>${lastRun} <span style="color:#666;font-size:0.8em">(${ago})</span></td>
          <td>${h.records_upserted} / ${dur}</td>
          ${errorCell}
        </tr>`;
      }).join('');

      const allOk = SCRAPER_ORDER.every(n => healthMap[n]?.status === 'success');
      const banner = allOk
        ? '<div style="background:#1b3a1b;border:1px solid #2E7D32;border-radius:6px;padding:10px 16px;margin-bottom:20px;color:#81c784">✅ All scrapers running normally</div>'
        : '<div style="background:#3a1b1b;border:1px solid #c62828;border-radius:6px;padding:10px 16px;margin-bottom:20px;color:#ef9a9a">⚠️ One or more scrapers need attention</div>';

      const statusHtml = `<!DOCTYPE html><html lang="en"><head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Scraper Status — UK Power Cut Aggregator</title>
        <style>
          * { margin:0;padding:0;box-sizing:border-box; }
          body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1a1a2e;color:#ddd;padding:32px 24px;font-size:0.88rem; }
          h1 { color:#e94560;margin-bottom:4px;font-size:1.2rem; }
          .sub { color:#666;margin-bottom:24px;font-size:0.8rem; }
          table { width:100%;border-collapse:collapse;max-width:900px; }
          th { text-align:left;color:#888;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;padding:8px 12px;border-bottom:1px solid #0f3460; }
          td { padding:10px 12px;border-bottom:1px solid #1a2a4a;vertical-align:top; }
          tr:last-child td { border-bottom:none; }
          a { color:#6ab0f5;text-decoration:none; } a:hover { text-decoration:underline; }
        </style>
      </head><body>
        <h1>Scraper Status</h1>
        <p class="sub">Updates every 20 minutes &nbsp;&middot;&nbsp; <a href="/">← Back to map</a></p>
        ${banner}
        <table>
          <thead><tr><th>Scraper</th><th>Status</th><th>Last run</th><th>Records / Duration</th><th>Error</th></tr></thead>
          <tbody>${rows_html}</tbody>
        </table>
      </body></html>`;

      setSecurityHeaders(res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(statusHtml);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Error loading status');
    }
    return;
  }

  if (path === '/api/outages') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (isRateLimited(ip)) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', '60');
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    try {
      const data = await getOutages();
      setSecurityHeaders(res);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(PAGE_HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}/`);
});
