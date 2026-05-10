#!/usr/bin/env node

/**
 * Electricity North West (ENWL) Data Fetcher
 * Coverage: Northwest England (Cheshire, Cumbria, Greater Manchester, Lancashire, Merseyside)
 * Uses NEOP API - National Energy Outage Platform
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

// ENWL NEOP API endpoint
const ENWL_API_URL = 'https://api-test.enwl.co.uk/external/NEOP/OutageData';
const ENWL_API_KEY = process.env.ENWL_API_KEY;

/**
 * Fetch data from ENWL NEOP API
 */
async function fetchENWLData() {
  return new Promise((resolve, reject) => {
    console.log('📡 Fetching from ENWL NEOP API...');
    console.log(`   URL: ${ENWL_API_URL}\n`);

    if (!ENWL_API_KEY) {
      reject(new Error('ENWL_API_KEY not set in .env file'));
      return;
    }

    const options = {
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'Ocp-Apim-Subscription-Key': ENWL_API_KEY,
        'Cache-Control': 'no-cache'
      }
    };

    https.get(ENWL_API_URL, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        try {
          const json = JSON.parse(data);

          // NEOP API returns array of outage records
          if (Array.isArray(json)) {
            resolve(json);
          } else if (json.outages && Array.isArray(json.outages)) {
            resolve(json.outages);
          } else if (json.data && Array.isArray(json.data)) {
            resolve(json.data);
          } else {
            reject(new Error('Unexpected API response structure'));
          }
        } catch (err) {
          reject(new Error(`JSON parse error: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Normalize ENWL record to our schema
 */
function normalizeENWLRecord(record) {
  const reference = record.incident_id || record.fault_id || record.outage_id || record.id || '';
  const status = (record.status || record.incident_status || '').toLowerCase();
  const postcode = record.postcode || record.post_code || '';
  const area = record.area || record.region || record.network_area || 'North West';
  const startTime = record.start_time || record.incident_start_time || record.reported_time || '';
  const endTime = record.end_time || record.estimated_restoration || record.eta || record.estimated_time || '';
  const description = record.description || record.fault_description || record.cause || '';
  const customersText = record.customers_affected || record.customer_count || record.customers || '0';

  // Parse customer count
  const customersAffected = parseInt(customersText.toString().match(/\d+/)?.[0] || '0');

  // Determine if planned
  const isPlanned = description.toLowerCase().includes('planned') ||
                    description.toLowerCase().includes('scheduled') ||
                    description.toLowerCase().includes('maintenance') ||
                    (record.planned !== undefined && record.planned);

  // Parse times
  const startTimeISO = startTime ? new Date(startTime).toISOString() : new Date().toISOString();
  const endTimeISO = endTime ? new Date(endTime).toISOString() : null;

  // Determine status
  let currentStatus = 'active';
  if (status.includes('resolved') || status.includes('restored') || status.includes('completed')) {
    currentStatus = 'resolved';
  }

  return {
    dno: 'ENWL',
    dno_fault_id: (reference || '').substring(0, 100),
    outage_type: isPlanned ? 'planned' : 'unplanned',
    severity: null,
    affected_postcode_area: postcode ? postcode.substring(0, 4) : null,
    affected_postcodes: postcode ? [postcode] : [],
    customers_affected: customersAffected,
    location_description: `${area}${postcode ? ', ' + postcode : ''}`.substring(0, 500),
    lat: record.latitude ? parseFloat(record.latitude) : null,
    lon: record.longitude ? parseFloat(record.longitude) : null,
    start_time: startTimeISO,
    estimated_restoration_time: endTimeISO,
    actual_restoration_time: currentStatus === 'resolved' ? endTimeISO : null,
    expected_duration_minutes: null,
    cause: description.substring(0, 255),
    fault_description: `ENWL: ${description}`,
    reference_number: (reference || '').substring(0, 100),
    source_url: 'https://www.enwl.co.uk/power-cuts/',
    status: currentStatus,
    raw_data: record,
  };
}

/**
 * Insert outage into database
 */
async function insertOutage(outageData) {
  const { data, error } = await supabase
    .from('outages')
    .upsert(
      {
        dno: outageData.dno,
        dno_fault_id: outageData.dno_fault_id,
        outage_type: outageData.outage_type,
        severity: outageData.severity,
        affected_postcode_area: outageData.affected_postcode_area,
        affected_postcodes: outageData.affected_postcodes,
        customers_affected: outageData.customers_affected,
        location_description: outageData.location_description,
        lat: outageData.lat,
        lon: outageData.lon,
        start_time: outageData.start_time,
        estimated_restoration_time: outageData.estimated_restoration_time,
        actual_restoration_time: outageData.actual_restoration_time,
        expected_duration_minutes: outageData.expected_duration_minutes,
        cause: outageData.cause,
        fault_description: outageData.fault_description,
        reference_number: outageData.reference_number,
        source_url: outageData.source_url,
        status: outageData.status,
        raw_data: outageData.raw_data,
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
 * Main workflow
 */
async function main() {
  const startTime = Date.now();

  try {
    console.log('🚀 ENWL Data Fetcher - Stage 1: Data Ingestion\n');
    console.log('='.repeat(60) + '\n');

    const records = await fetchENWLData();
    console.log(`✅ Fetched ${records.length} records from ENWL\n`);

    if (records.length === 0) {
      console.log('⚠️  No outages found.');
      console.log('   This may mean no active outages.\n');
      process.exit(0);
    }

    // Debug: show first record structure
    if (records.length > 0) {
      console.log('📋 First record structure:');
      console.log(JSON.stringify(records[0], null, 2));
      console.log('\n');
    }

    console.log(`📋 Processing ${records.length} records...\n`);

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];

    for (let idx = 0; idx < records.length; idx++) {
      const record = records[idx];
      try {
        const normalized = normalizeENWLRecord(record);

        // Skip if no valid reference
        if (!normalized.dno_fault_id) {
          continue;
        }

        const result = await insertOutage(normalized);

        successCount++;

        // Keep first 3 for display
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
        console.error(`❌ Error processing record ${idx + 1}: ${err.message}`);
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
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Fault ID: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location}`);
        console.log(`   Customers: ${outage.customers}`);
        console.log(`   Cause: ${outage.cause.substring(0, 50)}...`);
        console.log(`   Started: ${new Date(outage.start_time).toLocaleString()}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ ENWL data ingestion complete!\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check network connection');
    console.error('2. Verify ENWL API is accessible');
    console.error('3. Verify Supabase credentials in .env\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchENWLData,
  normalizeENWLRecord,
  insertOutage,
};
