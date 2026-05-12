#!/usr/bin/env node

/**
 * SP Energy Networks Data Fetcher
 * Coverage: SP Distribution (Scotland) and SP Manweb (Wales/Cheshire)
 * Uses Puppeteer to load the page, then intercepts the Salesforce Apex API
 * responses to get structured JSON (isPlanned, incidentReference, etc.)
 * instead of parsing the DOM.
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();
const { reportSuccess, reportFailure } = require('../lib/health');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

const APEX_EXECUTE_URL = 'webruntime/api/apex/execute';

async function fetchSPEnergyData() {
  let browser;
  try {
    console.log('🌐 Launching browser...\n');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    // Intercept getImpactData responses
    const capturedRecords = [];
    let captureComplete = false;

    page.on('response', async (response) => {
      if (!response.url().includes(APEX_EXECUTE_URL)) return;
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        if (Array.isArray(json.returnValue) && json.returnValue.length > 0) {
          const first = json.returnValue[0];
          // Only capture outage records (have incidentReference field)
          if (first && 'incidentReference' in first) {
            capturedRecords.push(...json.returnValue);
            console.log(`📡 Intercepted API response: ${json.returnValue.length} records`);
          }
        }
      } catch {}
    });

    console.log('📡 Navigating to SP Energy power cuts list...\n');
    await page.goto('https://powercuts.spenergynetworks.co.uk/list', { waitUntil: 'networkidle2' });

    console.log('⏳ Waiting for page to render...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // The default page size is 5 — we need to paginate through all pages.
    // After each page, click next and wait for the new API response.
    // We detect "no more pages" when clicking fails.
    let pageNum = 1;

    while (true) {
      const nextPage = pageNum + 1;
      const prevCount = capturedRecords.length;

      const clicked = await page.evaluate((targetPage) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          if (node.childNodes.length === 1 &&
              node.childNodes[0].nodeType === 3 &&
              node.childNodes[0].textContent.trim() === String(targetPage)) {
            node.click();
            return true;
          }
        }
        return false;
      }, nextPage);

      if (!clicked) {
        console.log(`📄 No page ${nextPage} — all pages collected\n`);
        break;
      }

      console.log(`📄 Clicking page ${nextPage}...`);
      // Wait for new API response to arrive
      await new Promise(resolve => setTimeout(resolve, 3000));

      if (capturedRecords.length === prevCount) {
        console.log(`⚠️  No new records after clicking page ${nextPage} — stopping`);
        break;
      }

      pageNum = nextPage;
    }

    await browser.close();

    // Deduplicate by incidentReference (same record may appear on multiple pages if restored)
    const seen = new Set();
    const unique = capturedRecords.filter(r => {
      const key = r.incidentReference || JSON.stringify(r.outCodes);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`✅ Total unique records captured: ${unique.length}\n`);
    return unique;
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

/**
 * Parse SP Energy's US-format date: "5/11/2026, 11:59 PM"
 */
function parseSpEnergyDate(str) {
  if (!str) return null;
  const match = str.match(/(\d+)\/(\d+)\/(\d{4}),\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  const [, month, day, year, hourStr, min, ampm] = match;
  let hour = parseInt(hourStr);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const date = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${min}:00`);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Parse SP Energy's created date: "2026-05-11 18:04:00"
 */
function parseCreatedDate(str) {
  if (!str) return null;
  const date = new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeRecord(record) {
  const postcodesAffected = Array.isArray(record.outCodes) ? record.outCodes : [];
  const postcodeArea = postcodesAffected[0] || null;
  const locationDesc = [postcodeArea, record.postcodeList]
    .filter(Boolean).join(' — ').substring(0, 255) || 'SP Energy Networks';

  const isResolved = /restored/i.test(record.status || '');
  const isPlanned = record.isPlanned === true || /planned/i.test(record.status || '');

  return {
    dno: 'SPE',
    dno_fault_id: `SPE-${record.incidentReference || postcodeArea}`.substring(0, 100),
    outage_type: isPlanned ? 'planned' : 'unplanned',
    severity: null,
    affected_postcode_area: postcodeArea ? postcodeArea.substring(0, 10) : null,
    affected_postcodes: postcodesAffected,
    customers_affected: record.spenPostCodesPerIncident || 0,
    location_description: locationDesc,
    lat: null,
    lon: null,
    start_time: parseCreatedDate(record.createdDate) || new Date().toISOString(),
    estimated_restoration_time: parseSpEnergyDate(record.estimatedFix),
    actual_restoration_time: parseSpEnergyDate(record.actualRestorationTime || null),
    expected_duration_minutes: null,
    cause: isPlanned ? 'Planned maintenance' : null,
    fault_description: (record.ivrMessage || record.mainMessage || null),
    reference_number: (record.incidentReference || '').substring(0, 100),
    source_url: 'https://powercuts.spenergynetworks.co.uk/list',
    status: isResolved ? 'resolved' : 'active',
    raw_data: record,
  };
}

async function resolveStaleOutages(activeFaultIds) {
  const { data: dbActive, error } = await supabase
    .from('outages')
    .select('dno_fault_id')
    .eq('dno', 'SPE')
    .eq('status', 'active');

  if (error) throw new Error(`DB query error: ${error.message}`);

  const staleIds = (dbActive || [])
    .map(r => r.dno_fault_id)
    .filter(id => !activeFaultIds.has(id));

  if (staleIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('outages')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('dno', 'SPE')
    .in('dno_fault_id', staleIds);

  if (updateError) throw new Error(`Resolve update error: ${updateError.message}`);
  return staleIds.length;
}

async function insertOutage(outageData) {
  const { error } = await supabase
    .from('outages')
    .upsert(
      { ...outageData, updated_at: new Date().toISOString() },
      { onConflict: 'dno,dno_fault_id' }
    );
  if (error) throw new Error(`Database insert error: ${error.message}`);
}

async function main() {
  const startTime = Date.now();

  try {
    console.log('🚀 SP Energy Networks Data Fetcher\n');
    console.log('='.repeat(60) + '\n');

    const records = await fetchSPEnergyData();

    if (records.length === 0) {
      console.log('⚠️  No outages captured.\n');
      await reportSuccess('SPE', 0, Date.now() - startTime);
      process.exit(0);
    }

    console.log(`📋 Processing ${records.length} records...\n`);

    let successCount = 0;
    let errorCount = 0;
    let plannedCount = 0;
    const sampleOutages = [];
    const activeFaultIds = new Set();

    for (let idx = 0; idx < records.length; idx++) {
      const record = records[idx];
      try {
        const normalized = normalizeRecord(record);
        if (!normalized.dno_fault_id) continue;

        activeFaultIds.add(normalized.dno_fault_id);
        await insertOutage(normalized);
        successCount++;
        if (normalized.outage_type === 'planned') plannedCount++;
        if (sampleOutages.length < 3) sampleOutages.push(normalized);
      } catch (err) {
        console.error(`❌ Error processing record ${idx + 1}: ${err.message}`);
        errorCount++;
      }
    }

    const resolvedCount = await resolveStaleOutages(activeFaultIds);

    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully upserted: ${successCount} outages (${plannedCount} planned)`);
    console.log(`🔄 Resolved (stale):     ${resolvedCount}`);
    console.log(`❌ Failed:               ${errorCount}`);
    console.log(`⏱️  Duration: ${Date.now() - startTime}ms\n`);

    if (sampleOutages.length > 0) {
      console.log('📌 SAMPLE OUTAGES INGESTED:\n');
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Fault ID: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location_description}`);
        console.log(`   Type: ${outage.outage_type} | Status: ${outage.status}`);
        console.log(`   ETR: ${outage.estimated_restoration_time || 'Unknown'}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ SP Energy data ingestion complete!\n');
    await reportSuccess('SPE', successCount, Date.now() - startTime);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check if Chrome/Chromium is installed');
    console.error('2. Verify SP Energy website is accessible');
    await reportFailure('SPE', err, Date.now() - startTime);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { fetchSPEnergyData, normalizeRecord, insertOutage, resolveStaleOutages };
