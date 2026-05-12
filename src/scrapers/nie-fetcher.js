#!/usr/bin/env node

/**
 * NIE Networks Data Fetcher
 * Coverage: Northern Ireland (all BT postcodes)
 * API: https://powercheck.nienetworks.co.uk/NIEPowerCheckerWebAPI/api/faults
 * No authentication required.
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();
const { reportSuccess, reportFailure } = require('../lib/health');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

const NIE_API_URL = 'https://powercheck.nienetworks.co.uk/NIEPowerCheckerWebAPI/api/faults';

function fetchNIEData() {
  return new Promise((resolve, reject) => {
    https.get(NIE_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Convert Irish Grid (OSNI TM75) easting/northing to WGS84 lat/lon.
 * Implements TM inverse + 3-parameter Helmert datum shift (~2m accuracy).
 */
function irishGridToWGS84(E, N) {
  // Modified Airy ellipsoid (Irish Grid / TM75)
  const a = 6377340.189, b = 6356034.447;
  const F0 = 1.000035;
  const lat0 = 53.5 * Math.PI / 180, lon0 = -8.0 * Math.PI / 180;
  const E0 = 200000, N0 = 250000;

  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);

  function meridionalArc(phi) {
    return b * F0 * (
      (1 + n + 5/4*n**2 + 5/4*n**3) * (phi - lat0)
      - (3*n + 3*n**2 + 21/8*n**3) * Math.sin(phi - lat0) * Math.cos(phi + lat0)
      + (15/8*n**2 + 15/8*n**3) * Math.sin(2*(phi - lat0)) * Math.cos(2*(phi + lat0))
      - 35/24*n**3 * Math.sin(3*(phi - lat0)) * Math.cos(3*(phi + lat0))
    );
  }

  // Iteratively find latitude from northing
  let phi = (N - N0) / (a * F0) + lat0;
  for (let i = 0; i < 10; i++) {
    phi = (N - N0 - meridionalArc(phi)) / (a * F0) + phi;
    if (Math.abs(N - N0 - meridionalArc(phi)) < 0.001) break;
  }

  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi);
  const nu  = a * F0 / Math.sqrt(1 - e2 * sinPhi**2);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinPhi**2, 1.5);
  const eta2 = nu / rho - 1;
  const dE = E - E0;

  const VII  = tanPhi / (2 * rho * nu);
  const VIII = tanPhi / (24 * rho * nu**3) * (5 + 3*tanPhi**2 + eta2 - 9*tanPhi**2*eta2);
  const IX   = tanPhi / (720 * rho * nu**5) * (61 + 90*tanPhi**2 + 45*tanPhi**4);
  const X    = 1 / (cosPhi * nu);
  const XI   = 1 / (cosPhi * 6 * nu**3) * (nu/rho + 2*tanPhi**2);
  const XII  = 1 / (cosPhi * 120 * nu**5) * (5 + 28*tanPhi**2 + 24*tanPhi**4);
  const XIIA = 1 / (cosPhi * 5040 * nu**7) * (61 + 662*tanPhi**2 + 1320*tanPhi**4 + 720*tanPhi**6);

  const latRad = phi - VII*dE**2 + VIII*dE**4 - IX*dE**6;
  const lonRad = lon0 + X*dE - XI*dE**3 + XII*dE**5 - XIIA*dE**7;

  // Helmert 3-parameter datum shift: TM75 → WGS84
  const tx = -482.53, ty = 130.596, tz = 564.557;
  const nu2 = a / Math.sqrt(1 - e2 * Math.sin(latRad)**2);
  const Xc = nu2 * Math.cos(latRad) * Math.cos(lonRad);
  const Yc = nu2 * Math.cos(latRad) * Math.sin(lonRad);
  const Zc = nu2 * (1 - e2) * Math.sin(latRad);

  const a2 = 6378137.0, e2w = 0.00669437999014;  // WGS84
  const p = Math.sqrt((Xc + tx)**2 + (Yc + ty)**2);
  let lat2 = Math.atan2(Zc + tz, p * (1 - e2w));
  for (let i = 0; i < 10; i++) {
    const nu3 = a2 / Math.sqrt(1 - e2w * Math.sin(lat2)**2);
    lat2 = Math.atan2(Zc + tz + e2w * nu3 * Math.sin(lat2), p);
  }
  const lon2 = Math.atan2(Yc + ty, Xc + tx);

  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

/**
 * Parse Irish Grid coords from NIE point.coordinates string "E,N"
 */
function parseIrishGridCoords(point) {
  if (!point || !point.coordinates) return { lat: null, lon: null };
  const parts = point.coordinates.split(',').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return { lat: null, lon: null };
  try {
    const { lat, lon } = irishGridToWGS84(parts[0], parts[1]);
    if (lat < 54 || lat > 55.4 || lon < -8.2 || lon > -5.4) return { lat: null, lon: null };
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  } catch { return { lat: null, lon: null }; }
}

/**
 * Parse NIE date format: "8:01 PM, 10 May" or "11:30 PM, 10 May 2026"
 */
function parseNIEDate(str) {
  if (!str) return null;
  const year = new Date().getFullYear();
  const withYear = /\d{4}/.test(str) ? str : `${str} ${year}`;
  const match = withYear.match(/(\d{1,2}):(\d{2})\s*(AM|PM),\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!match) return null;
  const [, hours, minutes, ampm, day, month, yr] = match;
  let h = parseInt(hours);
  if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
  if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
  const date = new Date(`${day} ${month} ${yr} ${String(h).padStart(2, '0')}:${minutes}:00`);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNIERecord(outage) {
  const postcodes = (outage.fullPostCodes || outage.postCode || '')
    .split(/[,;]/)
    .map(p => p.trim())
    .filter(Boolean);

  const postcodeArea = postcodes.length > 0 ? postcodes[0].split(' ')[0] : null;

  const isPlanned = (outage.outageType || '').toLowerCase() === 'planned';

  const statusMsg = (outage.statusMessage || outage.status || '').toLowerCase();
  const isResolved = statusMsg.includes('restor') || statusMsg.includes('resolved') || statusMsg.includes('complet');

  return {
    dno: 'NIE',
    dno_fault_id: (outage.outageId || '').substring(0, 100),
    outage_type: isPlanned ? 'planned' : 'unplanned',
    severity: null,
    affected_postcode_area: postcodeArea,
    affected_postcodes: postcodes,
    customers_affected: parseInt(outage.numCustAffected) || 0,
    location_description: (outage.postCode || 'Northern Ireland').substring(0, 255),
    ...parseIrishGridCoords(outage.point),
    start_time: parseNIEDate(outage.startTime) || new Date().toISOString(),
    estimated_restoration_time: parseNIEDate(outage.estRestoreFullDateTime || outage.estRestoreTime),
    actual_restoration_time: null,
    expected_duration_minutes: null,
    cause: (outage.causeMessage || '').substring(0, 255) || null,
    fault_description: (outage.statusMessage || '').substring(0, 500) || null,
    reference_number: (outage.outageId || '').substring(0, 100),
    source_url: 'https://powercheck.nienetworks.co.uk/',
    status: isResolved ? 'resolved' : 'active',
    raw_data: outage,
  };
}

async function resolveStaleOutages(activeFaultIds) {
  const { data: dbActive, error } = await supabase
    .from('outages')
    .select('dno_fault_id')
    .eq('dno', 'NIE')
    .eq('status', 'active');

  if (error) throw new Error(`DB query error: ${error.message}`);

  const staleIds = (dbActive || [])
    .map(r => r.dno_fault_id)
    .filter(id => !activeFaultIds.has(id));

  if (staleIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('outages')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('dno', 'NIE')
    .in('dno_fault_id', staleIds);

  if (updateError) throw new Error(`Resolve update error: ${updateError.message}`);
  return staleIds.length;
}

async function insertOutage(outageData) {
  const { data, error } = await supabase
    .from('outages')
    .upsert(
      { ...outageData, updated_at: new Date().toISOString() },
      { onConflict: 'dno,dno_fault_id' }
    )
    .select();
  if (error) throw new Error(`Database insert error: ${error.message}`);
  return data;
}

async function main() {
  const startTime = Date.now();

  try {
    console.log('🚀 NIE Networks Data Fetcher\n');
    console.log('='.repeat(60) + '\n');

    console.log('📡 Fetching from NIE Powercheck API...');
    console.log(`   URL: ${NIE_API_URL}\n`);

    const response = await fetchNIEData();
    const outages = response.outageMessage || [];
    console.log(`✅ Fetched ${outages.length} outages from NIE\n`);

    if (outages.length === 0) {
      console.log('ℹ️  No active outages in Northern Ireland.\n');
      await reportSuccess('NIE', 0, Date.now() - startTime);
      process.exit(0);
    }

    console.log(`📋 Processing ${outages.length} outages...\n`);

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];
    const activeFaultIds = new Set();

    for (const outage of outages) {
      try {
        if (!outage.outageId) continue;
        const normalized = normalizeNIERecord(outage);
        activeFaultIds.add(normalized.dno_fault_id);
        await insertOutage(normalized);
        successCount++;
        if (sampleOutages.length < 3) sampleOutages.push(normalized);
      } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        errorCount++;
      }
    }

    const resolvedCount = await resolveStaleOutages(activeFaultIds);
    console.log(`🔄 Marked ${resolvedCount} stale outages as resolved\n`);

    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully upserted: ${successCount} outages`);
    console.log(`🔄 Resolved (stale):     ${resolvedCount}`);
    console.log(`❌ Failed:               ${errorCount}`);
    console.log(`⏱️  Duration: ${Date.now() - startTime}ms\n`);

    if (sampleOutages.length > 0) {
      console.log('📌 SAMPLE OUTAGES INGESTED:\n');
      sampleOutages.forEach((o, i) => {
        console.log(`${i + 1}. Fault ID: ${o.dno_fault_id}`);
        console.log(`   Location: ${o.location_description}`);
        console.log(`   Customers: ${o.customers_affected}`);
        console.log(`   Type: ${o.outage_type}`);
        console.log(`   Coords: ${o.lat}, ${o.lon}`);
        console.log(`   ETR: ${o.estimated_restoration_time || 'Unknown'}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ NIE Networks data ingestion complete!\n');
    await reportSuccess('NIE', successCount, Date.now() - startTime);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    await reportFailure('NIE', err, Date.now() - startTime);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { fetchNIEData, normalizeNIERecord, insertOutage, resolveStaleOutages };
