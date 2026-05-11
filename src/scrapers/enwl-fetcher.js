#!/usr/bin/env node

/**
 * ENWL (Electricity North West) Data Fetcher
 * Coverage: NW England (Cheshire, Cumbria, Greater Manchester, Lancashire, Merseyside)
 * API: https://www.enwl.co.uk/api/power-outages/search (no auth required)
 * Returns up to 100 outages per request including lat/lon, postcodes, ETR.
 * Note: when NEOP API key arrives, consider switching to api-test.enwl.co.uk.
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

const ENWL_API_URL = 'https://www.enwl.co.uk/api/power-outages/search'
  + '?pageSize=100&pageNumber=1'
  + '&includeCurrent=true'
  + '&includeResolved=false'
  + '&includeTodaysPlanned=true'
  + '&includeFuturePlanned=true'
  + '&includeCancelledPlanned=false';

function fetchENWLData() {
  return new Promise((resolve, reject) => {
    https.get(ENWL_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          resolve(json.Items || []);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function normalizeENWLRecord(item) {
  const isPlanned = (item.Type || '').toLowerCase().includes('planned');
  const isResolved = !!item.actualTimeOfRestoration ||
                     (item.Type || '').toLowerCase().includes('resolved');

  // Parse postcodes — "  BB1 1DN, BB1 1DH, ..." → clean array
  const postcodes = (item.AffectedPostcodes || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  const postcodeArea = postcodes.length > 0 ? postcodes[0].split(' ')[0] : null;

  const lat = item.outageCentrePoint ? item.outageCentrePoint.lat : null;
  const lon = item.outageCentrePoint ? item.outageCentrePoint.lng : null;

  const etr = item.estimatedTimeOfRestoration
    ? new Date(item.estimatedTimeOfRestoration).toISOString()
    : null;

  const actualRestoration = item.actualTimeOfRestoration
    ? new Date(item.actualTimeOfRestoration).toISOString()
    : null;

  const startTime = item.date
    ? new Date(item.date).toISOString()
    : new Date().toISOString();

  return {
    dno: 'ENWL',
    dno_fault_id: (item.faultNumber || '').substring(0, 100),
    outage_type: isPlanned ? 'planned' : 'unplanned',
    severity: null,
    affected_postcode_area: postcodeArea,
    affected_postcodes: postcodes,
    customers_affected: parseInt(item.consumersOff) || 0,
    location_description: (item.region || 'North West England').substring(0, 255),
    lat,
    lon,
    start_time: startTime,
    estimated_restoration_time: etr,
    actual_restoration_time: actualRestoration,
    expected_duration_minutes: null,
    cause: (item.faultStatus || item.FaultLabel || '').substring(0, 255) || null,
    fault_description: `ENWL: ${item.FaultLabel || item.faultType || 'Power cut'}`,
    reference_number: (item.faultNumber || '').substring(0, 100),
    source_url: 'https://www.enwl.co.uk/power-cuts/',
    status: isResolved ? 'resolved' : 'active',
    raw_data: item,
  };
}

async function resolveStaleOutages(activeFaultIds) {
  const { data: dbActive, error } = await supabase
    .from('outages')
    .select('dno_fault_id')
    .eq('dno', 'ENWL')
    .eq('status', 'active');

  if (error) throw new Error(`DB query error: ${error.message}`);

  const staleIds = (dbActive || [])
    .map(r => r.dno_fault_id)
    .filter(id => !activeFaultIds.has(id));

  if (staleIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('outages')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('dno', 'ENWL')
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
    console.log('🚀 ENWL Data Fetcher\n');
    console.log('='.repeat(60) + '\n');

    console.log('📡 Fetching from ENWL website API...');
    console.log(`   URL: ${ENWL_API_URL}\n`);

    const items = await fetchENWLData();
    console.log(`✅ Fetched ${items.length} outages from ENWL\n`);

    if (items.length === 0) {
      console.log('ℹ️  No active outages in NW England.\n');
      process.exit(0);
    }

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];
    const activeFaultIds = new Set();

    for (const item of items) {
      try {
        if (!item.faultNumber) continue;
        const normalized = normalizeENWLRecord(item);
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
        console.log(`   ETR: ${o.estimated_restoration_time || 'Unknown'}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ ENWL data ingestion complete!\n');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { fetchENWLData, normalizeENWLRecord, insertOutage, resolveStaleOutages };
