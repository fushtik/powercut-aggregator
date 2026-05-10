#!/usr/bin/env node

const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

const PORT = process.env.SERVER_PORT || 3000;

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

    .leaflet-popup-content-wrapper { background: #16213e; color: #eee; border: 1px solid #0f3460; border-radius: 8px; }
    .leaflet-popup-tip { background: #16213e; }
    .leaflet-popup-content { margin: 12px 16px; font-size: 0.82rem; line-height: 1.6; }
    .popup-dno { font-weight: 700; font-size: 0.95rem; margin-bottom: 4px; }
    .popup-row { display: flex; justify-content: space-between; gap: 16px; }
    .popup-label { color: #888; }
    .popup-badge { display: inline-block; padding: 1px 7px; border-radius: 8px; font-size: 0.7rem; font-weight: 600; }
    .badge-unplanned { background: #c62828; color: #fff; }
    .badge-planned { background: #e65100; color: #fff; }
    .popup-approx { font-size: 0.68rem; color: #888; margin-top: 6px; font-style: italic; }
  </style>
</head>
<body>

<div id="header">
  <div>
    <h1>UK Power Cut Aggregator</h1>
    <div class="subtitle">Live active outages from 6 DNOs</div>
  </div>
  <div id="stats">
    <span id="total-chip" class="stat-chip">Loading...</span>
  </div>
</div>

<div id="map"><div class="loading">Loading outages...</div></div>

<div id="legend">
  <h4>DNO</h4>
  <div class="legend-row"><span class="legend-dot" style="background:#1565C0"></span><span class="legend-label">UKPN</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#2E7D32"></span><span class="legend-label">SSEN</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#E65100"></span><span class="legend-label">Northern Powergrid</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#C62828"></span><span class="legend-label">SP Energy</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#6A1B9A"></span><span class="legend-label">NGED</span></div>
  <div class="legend-row"><span class="legend-dot" style="background:#00838F"></span><span class="legend-label">NIE</span></div>
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

const map = L.map('map', { zoomControl: true }).setView([54.5, -3.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 18,
}).addTo(map);

fetch('/api/outages')
  .then(r => r.json())
  .then(outages => {
    const dnoCounts = {};
    let totalCustomers = 0;
    let plotted = 0;

    outages.forEach(outage => {
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
      }).addTo(map);

      const etr = outage.estimated_restoration_time ? formatTime(outage.estimated_restoration_time) : 'Unknown';
      const customers = outage.customers_affected > 0 ? outage.customers_affected.toLocaleString() : '<10';

      marker.bindPopup(\`
        <div class="popup-dno" style="color:\${color}">\${outage.dno}</div>
        <div class="popup-row">
          <span class="popup-label">Location</span>
          <span>\${outage.location_description || outage.affected_postcode_area || '—'}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Type</span>
          <span class="popup-badge \${badgeClass}">\${outage.outage_type}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Customers</span>
          <span>\${customers}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">ETR</span>
          <span>\${etr}</span>
        </div>
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
  })
  .catch(err => {
    document.querySelector('.loading') && (document.querySelector('.loading').textContent = 'Failed to load outages');
    console.error(err);
  });
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];

  if (path === '/api/outages') {
    try {
      const data = await getOutages();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify(data));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(PAGE_HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}/`);
});
