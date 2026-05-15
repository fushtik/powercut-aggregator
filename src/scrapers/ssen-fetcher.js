#!/usr/bin/env node

/**
 * SSEN (Scottish & Southern Electricity Networks) Data Fetcher
 * Pulls real-time outage data from SSEN's public API
 * https://ssen-powertrack-api.opcld.com/gridiview/reporter/info
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();
const { reportSuccess, reportFailure } = require('../lib/health');

// Supabase client with WebSocket transport for Node.js 20
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

// SSEN API configuration
const SSEN_API_URL = 'https://ssen-powertrack-api.opcld.com/gridiview/reporter/info';

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
  const typeMap = {
    'LV': 'unplanned',
    'HV': 'unplanned',
    'PSI': 'planned',
  };

  const postcodeArea = fault.affectedAreas && fault.affectedAreas.length > 0
    ? fault.affectedAreas[0].trim().split(' ')[0].substring(0, 4)
    : null;

  return {
    dno: 'SSEN',
    dno_fault_id: (fault.reference || `ssen_${Date.now()}`).substring(0, 100),
    outage_type: typeMap[fault.type] || 'unplanned',
    severity: null,
    affected_postcode_area: postcodeArea,
    affected_postcodes: fault.affectedAreas || [],
    customers_affected: fault.affectedCustomerCount || 0,
    location_description: (fault.name || 'Unknown location').substring(0, 500),
    lat: fault.latitude || null,
    lon: fault.longitude || null,
    start_time: fault.loggedAt ? new Date(fault.loggedAt).toISOString() : new Date().toISOString(),
    estimated_restoration_time: fault.estimatedRestoration
      ? new Date(fault.estimatedRestoration).toISOString()
      : null,
    actual_restoration_time: null,
    expected_duration_minutes: null,
    cause: fault.type ? `${fault.type} Fault` : 'Unknown cause',
    fault_description: (fault.message || ''),
    reference_number: (fault.reference || null)?.substring(0, 100),
    source_url: 'https://ssen-powertrack-api.opcld.com/gridiview/reporter/info',
    status: fault.resolved ? 'resolved' : 'active',
    raw_data: fault,
  };
}

async function resolveStaleOutages(activeFaultIds) {
  // Mark any SSEN records in the DB that are no longer in the live API as resolved
  const { data: dbActive, error } = await supabase
    .from('outages')
    .select('dno_fault_id')
    .eq('dno', 'SSEN')
    .eq('status', 'active');

  if (error) throw new Error(`DB query error: ${error.message}`);

  const staleIds = (dbActive || [])
    .map(r => r.dno_fault_id)
    .filter(id => !activeFaultIds.has(id));

  if (staleIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('outages')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('dno', 'SSEN')
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
    console.log('🚀 SSEN Data Fetcher - Stage 1: Data Ingestion\n');
    console.log('='.repeat(60) + '\n');

    // Fetch from SSEN API
    const apiResponse = await fetchSSENData();
    console.log(`✅ Fetched data from SSEN API\n`);

    const faults = apiResponse.Faults || [];
    console.log(`📋 Processing ${faults.length} faults...\n`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const sampleOutages = [];
    const activeFaultIds = new Set();

    for (const fault of faults) {
      try {
        // Skip faults merged into another — they'd double-count customers
        if (fault.mergedTo) {
          skippedCount++;
          continue;
        }

        const normalized = normalizeSSENRecord(fault);

        // Track all IDs seen regardless of resolved status (so we don't un-resolve them)
        activeFaultIds.add(normalized.dno_fault_id);

        await insertOutage(normalized);
        successCount++;

        if (sampleOutages.length < 3 && normalized.status === 'active') {
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

    // Mark any previously-active SSEN faults that are no longer in the API as resolved
    const resolvedCount = await resolveStaleOutages(activeFaultIds);
    console.log(`🔄 Marked ${resolvedCount} stale outages as resolved\n`);

    // Summary
    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully upserted: ${successCount} faults`);
    console.log(`🔄 Resolved (stale):     ${resolvedCount}`);
    console.log(`⏭️  Skipped (merged):     ${skippedCount}`);
    console.log(`❌ Failed:               ${errorCount}`);
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

    await reportSuccess('SSEN', successCount, Date.now() - startTime);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check network connection');
    console.error('2. Verify SSEN API is accessible');
    console.error('3. Verify Supabase credentials in .env\n');
    await reportFailure('SSEN', err, Date.now() - startTime);
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
  resolveStaleOutages,
};
