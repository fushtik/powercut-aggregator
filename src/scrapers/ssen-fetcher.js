#!/usr/bin/env node

/**
 * SSEN (Scottish & Southern Electricity Networks) Data Fetcher
 * Pulls real-time outage data from SSEN's public API
 * https://external.distribution.prd.ssen.co.uk/opendataportal-prd/v4/api/getallfaults
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

// SSEN API configuration
const SSEN_API_URL = 'https://external.distribution.prd.ssen.co.uk/opendataportal-prd/v4/api/getallfaults';

/**
 * Fetch data from SSEN API
 */
async function fetchSSENData() {
  return new Promise((resolve, reject) => {
    https.get(SSEN_API_URL, (res) => {
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
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(new Error(`JSON parse error: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Normalize SSEN data to our schema
 */
function normalizeSSENRecord(fault) {
  // Map SSEN fault types to our outage_type
  const typeMap = {
    'LV': 'unplanned',
    'HV': 'unplanned',
    'PSI': 'planned',
  };

  return {
    dno: 'SSEN',
    dno_fault_id: (fault.reference || `ssen_${Date.now()}`).substring(0, 100),
    outage_type: typeMap[fault.type] || 'unplanned',
    severity: null, // SSEN doesn't provide severity
    affected_postcode_area: fault.affectedAreas && fault.affectedAreas.length > 0
      ? fault.affectedAreas[0].substring(0, 4)
      : null,
    affected_postcodes: fault.affectedAreas || [],
    customers_affected: fault.customerCount || 0,
    location_description: (fault.title || 'Unknown location').substring(0, 500),
    lat: fault.location?.latitude || null,
    lon: fault.location?.longitude || null,
    start_time: fault.loggedAtUtc ? new Date(fault.loggedAtUtc).toISOString() : new Date().toISOString(),
    estimated_restoration_time: fault.estimatedRestorationTimeUtc
      ? new Date(fault.estimatedRestorationTimeUtc).toISOString()
      : null,
    actual_restoration_time: null,
    expected_duration_minutes: null,
    cause: fault.type ? `${fault.type} Fault` : 'Unknown cause',
    fault_description: (fault.message || ''),
    reference_number: (fault.reference || null)?.substring(0, 100),
    source_url: 'https://external.distribution.prd.ssen.co.uk/opendataportal-prd/v4/api/getallfaults',
    status: 'active',
    raw_data: fault,
  };
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
    console.log('🚀 SSEN Data Fetcher - Stage 1: Data Ingestion\n');
    console.log('='.repeat(60) + '\n');

    // Fetch from SSEN API
    const apiResponse = await fetchSSENData();
    console.log(`✅ Fetched data from SSEN API\n`);

    const faults = apiResponse.faults || [];
    console.log(`📋 Processing ${faults.length} faults...\n`);

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];

    for (const fault of faults) {
      try {
        // Normalize the record
        const normalized = normalizeSSENRecord(fault);

        // Insert into database
        const result = await insertOutage(normalized);

        successCount++;

        // Keep first 3 for display
        if (sampleOutages.length < 3) {
          sampleOutages.push({
            dno_fault_id: normalized.dno_fault_id,
            location: normalized.location_description,
            customers: normalized.customers_affected,
            start_time: normalized.start_time,
            eta: normalized.estimated_restoration_time,
          });
        }
      } catch (err) {
        console.error(`❌ Error processing fault: ${err.message}`);
        errorCount++;
      }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully inserted: ${successCount} faults`);
    console.log(`❌ Failed: ${errorCount} faults`);
    console.log(`⏱️  Duration: ${Date.now() - startTime}ms\n`);

    if (sampleOutages.length > 0) {
      console.log('📌 SAMPLE FAULTS INGESTED:\n');
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Fault ID: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location}`);
        console.log(`   Customers: ${outage.customers}`);
        console.log(`   Logged: ${new Date(outage.start_time).toLocaleString()}`);
        console.log(`   ETA: ${outage.eta ? new Date(outage.eta).toLocaleString() : 'Unknown'}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ SSEN data ingestion complete!\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check network connection');
    console.error('2. Verify SSEN API is accessible');
    console.error('3. Verify Supabase credentials in .env\n');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  fetchSSENData,
  normalizeSSENRecord,
  insertOutage,
};
