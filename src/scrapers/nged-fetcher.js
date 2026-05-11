#!/usr/bin/env node

/**
 * National Grid Electricity Distribution (NGED) Data Fetcher
 * Formerly Western Power Distribution (WPD)
 * Pulls live outage data from Connected Data Portal CSV
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

// Supabase client with WebSocket transport for Node.js 20
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

// NGED API configuration
const NGED_CSV_URL = 'https://connecteddata.nationalgrid.co.uk/dataset/d6672e1e-c684-4cea-bb78-c7e5248b62a2/resource/a1365982-4e05-463c-8304-8323a2ba0ccd/download/live_detailed_power_cuts.csv';

/**
 * Fetch and parse CSV data from NGED
 */
async function fetchNGEDData() {
  return new Promise((resolve, reject) => {
    const url = NGED_CSV_URL;

    console.log('📡 Fetching from NGED Connected Data Portal...');
    console.log(`   URL: ${url}\n`);

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }

        try {
          const records = parseCSV(data);
          resolve(records);
        } catch (err) {
          reject(new Error(`CSV parse error: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Parse CSV data
 */
function parseCSV(csvData) {
  const lines = csvData.trim().split('\n');

  if (lines.length < 2) {
    return [];
  }

  // Parse header
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());

  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Simple CSV parsing (handles quoted fields)
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const nextChar = line[j + 1];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    // Map to object
    const record = {};
    header.forEach((key, idx) => {
      record[key] = values[idx] || '';
    });

    records.push(record);
  }

  return records;
}

/**
 * Normalize NGED data to our schema
 */
function normalizeNGEDRecord(record) {
  // NGED CSV comes with quoted field names, so we need to handle both quoted and unquoted versions
  // Map quoted keys to unquoted for easier access
  const normalizeKey = (key) => key.replace(/^"|"$/g, '').toLowerCase();

  // Create a normalized record object
  const normalized = {};
  Object.keys(record).forEach(key => {
    normalized[normalizeKey(key)] = record[key];
  });

  // Extract fields from the normalized record
  const faultId = normalized['fault_id'] || '';
  const status = (normalized['status'] || '').toLowerCase();
  const postcode = normalized['postcode'] || '';
  const licenceArea = normalized['licence_area'] || '';
  const startTime = normalized['planned_outage_start_date'] || normalized['date_of_reported_fault'] || '';
  const endTime = normalized['planned_outage_end_date'] || normalized['date_of_restoration'] || '';
  const category = normalized['category'] || '';
  const reason = normalized['planned_outage_reason'] || '';
  const lat = normalized['location_latitude'] || null;
  const lon = normalized['location_longitude'] || null;
  const psrCustomers = parseInt(normalized['number_of_psr_customers'] || '0');
  const isPlanned = (normalized['planned'] || '').toLowerCase() === 'true';

  // Parse postcodes
  const postcodes = postcode ? [postcode.trim()] : [];
  const postcodeArea = postcode ? postcode.substring(0, 4) : null;

  // Determine outage type
  const outageType = isPlanned ? 'planned' : 'unplanned';

  // Parse times - NGED provides ISO 8601 format
  const startTimeISO = startTime ? new Date(startTime).toISOString() : new Date().toISOString();
  const endTimeISO = endTime ? new Date(endTime).toISOString() : null;

  // Determine current status
  let currentStatus = 'active';
  if (status.includes('resolved') || status.includes('restored') || status.includes('completed')) {
    currentStatus = 'resolved';
  }

  // Build description
  const description = `${category} - ${reason}`.replace(/^ - /, '').replace(/ - $/, '');
  const locationDesc = `${licenceArea}${postcode ? ', ' + postcode : ''}`;

  return {
    dno: 'NGED',
    dno_fault_id: (faultId || '').substring(0, 100),
    outage_type: outageType,
    severity: null,
    affected_postcode_area: postcodeArea,
    affected_postcodes: postcodes,
    customers_affected: psrCustomers,
    location_description: locationDesc.substring(0, 500),
    lat: lat ? parseFloat(lat) : null,
    lon: lon ? parseFloat(lon) : null,
    start_time: startTimeISO,
    estimated_restoration_time: endTimeISO,
    actual_restoration_time: currentStatus === 'resolved' ? endTimeISO : null,
    expected_duration_minutes: null,
    cause: category,
    fault_description: `NGED: ${description}`,
    reference_number: (faultId || '').substring(0, 100),
    source_url: 'https://connecteddata.nationalgrid.co.uk/',
    status: currentStatus,
    raw_data: record,
  };
}

async function resolveStaleOutages(activeFaultIds) {
  const { data: dbActive, error } = await supabase
    .from('outages')
    .select('dno_fault_id')
    .eq('dno', 'NGED')
    .eq('status', 'active');

  if (error) throw new Error(`DB query error: ${error.message}`);

  const staleIds = (dbActive || [])
    .map(r => r.dno_fault_id)
    .filter(id => !activeFaultIds.has(id));

  if (staleIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('outages')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('dno', 'NGED')
    .in('dno_fault_id', staleIds);

  if (updateError) throw new Error(`Resolve update error: ${updateError.message}`);
  return staleIds.length;
}

/**
 * Insert outage record into database
 */
async function insertOutage(outageData) {
  const {
    dno,
    dno_fault_id,
    outage_type,
    severity,
    affected_postcode_area,
    affected_postcodes,
    customers_affected,
    location_description,
    lat,
    lon,
    start_time,
    estimated_restoration_time,
    actual_restoration_time,
    expected_duration_minutes,
    cause,
    fault_description,
    reference_number,
    source_url,
    status,
    raw_data,
  } = outageData;

  const { data, error } = await supabase
    .from('outages')
    .upsert(
      {
        dno,
        dno_fault_id,
        outage_type,
        severity,
        affected_postcode_area,
        affected_postcodes,
        customers_affected,
        location_description,
        lat,
        lon,
        start_time,
        estimated_restoration_time,
        actual_restoration_time,
        expected_duration_minutes,
        cause,
        fault_description,
        reference_number,
        source_url,
        status,
        raw_data,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'dno,dno_fault_id',
      }
    )
    .select();

  if (error) {
    throw new Error(`Database insert error: ${error.message}`);
  }

  return data;
}

/**
 * Main fetch and insert workflow
 */
async function main() {
  const startTime = Date.now();

  try {
    console.log('🚀 NGED Data Fetcher - Stage 1: Data Ingestion\n');
    console.log('='.repeat(60) + '\n');

    // Fetch from NGED
    const records = await fetchNGEDData();
    console.log(`✅ Fetched ${records.length} records from NGED\n`);

    if (records.length === 0) {
      console.log('⚠️  No outages found.');
      console.log('   This may mean no active outages.\n');
      process.exit(0);
    }

    console.log(`📋 Processing ${records.length} records...\n`);

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];
    const activeFaultIds = new Set();

    for (let idx = 0; idx < records.length; idx++) {
      const record = records[idx];
      try {
        const normalized = normalizeNGEDRecord(record);

        if (!normalized.dno_fault_id) continue;

        activeFaultIds.add(normalized.dno_fault_id);
        await insertOutage(normalized);
        successCount++;

        if (sampleOutages.length < 3) {
          sampleOutages.push({
            dno_fault_id: normalized.dno_fault_id,
            location: normalized.location_description,
            customers: normalized.customers_affected,
            cause: normalized.cause,
            start_time: normalized.start_time,
          });
        }
      } catch (err) {
        console.error(`❌ Error processing record: ${err.message}`);
        errorCount++;
      }
    }

    const resolvedCount = await resolveStaleOutages(activeFaultIds);
    console.log(`🔄 Marked ${resolvedCount} stale outages as resolved\n`);

    // Summary
    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully upserted: ${successCount} outages`);
    console.log(`🔄 Resolved (stale):     ${resolvedCount}`);
    console.log(`❌ Failed:               ${errorCount}`);
    console.log(`⏱️  Duration: ${Date.now() - startTime}ms\n`);

    if (sampleOutages.length > 0) {
      console.log('📌 SAMPLE OUTAGES INGESTED:\n');
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Fault ID: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location}`);
        console.log(`   Customers: ${outage.customers}`);
        console.log(`   Cause: ${outage.cause}`);
        console.log(`   Started: ${new Date(outage.start_time).toLocaleString()}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ NGED data ingestion complete!\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check network connection');
    console.error('2. Verify NGED API is accessible');
    console.error('3. Verify Supabase credentials in .env\n');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  fetchNGEDData,
  normalizeNGEDRecord,
  insertOutage,
  resolveStaleOutages,
};
