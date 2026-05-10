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

  return {
    dno: 'NIE',
    dno_fault_id: (outage.outageId || '').substring(0, 100),
    outage_type: isPlanned ? 'planned' : 'unplanned',
    severity: null,
    affected_postcode_area: postcodeArea,
    affected_postcodes: postcodes,
    customers_affected: parseInt(outage.numCustAffected) || 0,
    location_description: (outage.postCode || 'Northern Ireland').substring(0, 255),
    lat: null,  // Coordinates are Irish Grid (OSNI) — conversion requires proj4, deferred
    lon: null,
    start_time: parseNIEDate(outage.startTime) || new Date().toISOString(),
    estimated_restoration_time: parseNIEDate(outage.estRestoreFullDateTime || outage.estRestoreTime),
    actual_restoration_time: null,
    expected_duration_minutes: null,
    cause: (outage.causeMessage || '').substring(0, 255) || null,
    fault_description: (outage.statusMessage || '').substring(0, 500) || null,
    reference_number: (outage.outageId || '').substring(0, 100),
    source_url: 'https://powercheck.nienetworks.co.uk/',
    status: 'active',
    raw_data: outage,
  };
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
      process.exit(0);
    }

    console.log(`📋 Processing ${outages.length} outages...\n`);

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];

    for (const outage of outages) {
      try {
        if (!outage.outageId) continue;
        const normalized = normalizeNIERecord(outage);
        await insertOutage(normalized);
        successCount++;
        if (sampleOutages.length < 3) sampleOutages.push(normalized);
      } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        errorCount++;
      }
    }

    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully inserted: ${successCount} outages`);
    console.log(`❌ Failed: ${errorCount} outages`);
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
    console.log('\n✨ NIE Networks data ingestion complete!\n');
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

module.exports = { fetchNIEData, normalizeNIERecord, insertOutage };
