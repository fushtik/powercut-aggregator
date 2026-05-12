#!/usr/bin/env node

/**
 * UKPN (UK Power Networks) Data Fetcher
 * Pulls live outage data from OpenDataSoft API
 * https://ukpowernetworks.opendatasoft.com/explore/dataset/ukpn-live-faults/
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

// UKPN API configuration
const UKPN_API_HOST = 'ukpowernetworks.opendatasoft.com';
const UKPN_API_PATH = '/api/v2/catalog/datasets/ukpn-live-faults/records';

/**
 * Fetch one page from UKPN API
 */
function fetchUKPNPage(offset) {
  return new Promise((resolve, reject) => {
    const url = `https://${UKPN_API_HOST}${UKPN_API_PATH}?limit=100&offset=${offset}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(new Error(`JSON parse error: ${err.message}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch all UKPN records, paginating until complete
 */
async function fetchUKPNData() {
  console.log('📡 Fetching from UKPN API...');
  console.log(`   URL: https://${UKPN_API_HOST}${UKPN_API_PATH}?limit=100\n`);

  const firstPage = await fetchUKPNPage(0);
  const totalCount = firstPage.total_count || 0;
  const allRecords = [...(firstPage.records || [])];

  console.log(`   Total available: ${totalCount}`);

  let offset = 100;
  while (offset < totalCount) {
    const page = await fetchUKPNPage(offset);
    const batch = page.records || [];
    if (batch.length === 0) break;
    allRecords.push(...batch);
    offset += batch.length;
  }

  return { total_count: totalCount, records: allRecords };
}

/**
 * Format a spaceless UK postcode (e.g. SE145AW → SE14 5AW)
 * UK inward codes are always 3 chars, so insert a space 3 chars from the end.
 */
function formatUKPostcode(pc) {
  const clean = (pc || '').replace(/\s+/g, '');
  if (clean.length < 5) return clean;
  return clean.slice(0, -3) + ' ' + clean.slice(-3);
}

/**
 * Normalize UKPN data to our schema
 */
function normalizeUKPNRecord(record) {
  // Extract fields - UKPN nests them in record.fields or record.record.fields
  const fields = record.record?.fields || record.fields || record;

  // fullpostcodedata: spaceless full postcodes "SE145AW;SE145DS" — format each one
  // postcodesaffected: sector codes "SE14 5" or "NR11 6;NR11 7" — already partially formatted
  let postcodesAffected, postcodeArea;
  if (fields.fullpostcodedata) {
    postcodesAffected = fields.fullpostcodedata.split(';').map(p => p.trim()).filter(Boolean).map(formatUKPostcode);
    postcodeArea = postcodesAffected.length > 0 ? postcodesAffected[0].split(' ')[0] : null;
  } else if (fields.postcodesaffected) {
    postcodesAffected = fields.postcodesaffected.split(';').map(p => p.trim()).filter(Boolean);
    // Sector code like "SE14 5" — area is everything before the last space-separated segment
    const parts = (postcodesAffected[0] || '').split(' ');
    postcodeArea = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || null;
  } else {
    postcodesAffected = [];
    postcodeArea = null;
  }

  // Determine outage type
  const outageType = fields.powercuttype
    ? fields.powercuttype.toLowerCase() === 'planned'
      ? 'planned'
      : 'unplanned'
    : fields.incidenttype === 3
    ? 'planned'
    : 'unplanned';

  // Get customer count
  const customersAffected = fields.nocustomeraffected ||
    fields.noplannedcustomers ||
    fields.nounplannedcustomers ||
    0;

  // Parse timestamps
  const startTime = fields.creationdatetime || fields.planneddate || new Date().toISOString();
  const estimatedRestoration = fields.estimatedrestorationdate || null;

  // Location description
  const location = fields.operatingzone || fields.incidentcategorycustomerfriendlydescription
    ? `${fields.operatingzone || ''}`.trim()
    : postcodesAffected.join(', ') || 'Unknown location';

  return {
    dno: 'UKPN',
    dno_fault_id: (fields.incidentreference || `ukpn_${Date.now()}`).substring(0, 100),
    outage_type: outageType,
    severity: null, // UKPN doesn't provide severity levels
    affected_postcode_area: postcodeArea,
    affected_postcodes: postcodesAffected,
    customers_affected: customersAffected,
    location_description: location.substring(0, 500),
    lat: fields.geopoint?.lat || null,
    lon: fields.geopoint?.lon || null,
    start_time: new Date(startTime).toISOString(),
    estimated_restoration_time: estimatedRestoration ? new Date(estimatedRestoration).toISOString() : null,
    actual_restoration_time: fields.restoreddatetime ? new Date(fields.restoreddatetime).toISOString() : null,
    expected_duration_minutes: null, // Calculate from timestamps if both available
    cause: ((fields.plannedincidentreason || fields.incidentdescription || '') + '').substring(0, 255),
    fault_description: (fields.mainmessage || fields.incidentcategorycustomerfriendlydescription || ''),
    reference_number: ((fields.incidentreference || '') + '').substring(0, 100),
    source_url: 'https://ukpowernetworks.opendatasoft.com/explore/dataset/ukpn-live-faults/'.substring(0, 500),
    status: fields.statusid === 0 ? 'resolved' : 'active',
    raw_data: record,
  };
}

async function resolveStaleOutages(activeFaultIds) {
  const { data: dbActive, error } = await supabase
    .from('outages')
    .select('dno_fault_id')
    .eq('dno', 'UKPN')
    .eq('status', 'active');

  if (error) throw new Error(`DB query error: ${error.message}`);

  const staleIds = (dbActive || [])
    .map(r => r.dno_fault_id)
    .filter(id => !activeFaultIds.has(id));

  if (staleIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('outages')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('dno', 'UKPN')
    .in('dno_fault_id', staleIds);

  if (updateError) throw new Error(`Resolve update error: ${updateError.message}`);
  return staleIds.length;
}

/**
 * Insert outage record into database
 * Uses ON CONFLICT to avoid duplicates
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
    console.log('🚀 UKPN Data Fetcher - Stage 1: Data Ingestion\n');
    console.log('=' .repeat(60) + '\n');

    // Fetch from UKPN API
    const apiResponse = await fetchUKPNData();
    console.log(`✅ Fetched ${apiResponse.total_count} total outages from UKPN API\n`);

    const records = apiResponse.records || [];
    console.log(`📋 Processing ${records.length} records...\n`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const sampleOutages = [];
    const activeFaultIds = new Set();
    const etrCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h grace period

    for (const record of records) {
      try {
        const normalized = normalizeUKPNRecord(record);

        // Skip records whose ETR has passed — UKPN leaves stale planned works
        // in the API for weeks without removing them.
        if (normalized.estimated_restoration_time &&
            new Date(normalized.estimated_restoration_time) < etrCutoff) {
          skippedCount++;
          continue; // not added to activeFaultIds → reconciliation will resolve it
        }

        activeFaultIds.add(normalized.dno_fault_id);
        await insertOutage(normalized);
        successCount++;

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
        console.error(`❌ Error processing record: ${err.message}`);
        errorCount++;
      }
    }

    const resolvedCount = await resolveStaleOutages(activeFaultIds);
    console.log(`🔄 Marked ${resolvedCount} stale outages as resolved\n`);

    // Summary
    console.log('=' .repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully upserted: ${successCount} outages`);
    console.log(`⏭️  Skipped (ETR passed): ${skippedCount}`);
    console.log(`🔄 Resolved (stale):     ${resolvedCount}`);
    console.log(`❌ Failed:               ${errorCount}`);
    console.log(`⏱️  Duration: ${Date.now() - startTime}ms\n`);

    if (sampleOutages.length > 0) {
      console.log('📌 SAMPLE OUTAGES INGESTED:\n');
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Fault ID: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location}`);
        console.log(`   Customers: ${outage.customers}`);
        console.log(`   Started: ${new Date(outage.start_time).toLocaleString()}`);
        console.log(`   ETA: ${outage.eta ? new Date(outage.eta).toLocaleString() : 'Unknown'}\n`);
      });
    }

    console.log('=' .repeat(60));
    console.log('\n✨ Data ingestion complete!\n');
    console.log('Next: Run queries to verify data in database\n');

    await reportSuccess('UKPN', successCount, Date.now() - startTime);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check network connection');
    console.error('2. Verify UKPN API is accessible');
    console.error('3. Verify Supabase credentials in .env\n');
    await reportFailure('UKPN', err, Date.now() - startTime);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  fetchUKPNData,
  normalizeUKPNRecord,
  insertOutage,
  resolveStaleOutages,
};
