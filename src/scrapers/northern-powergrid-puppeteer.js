#!/usr/bin/env node

/**
 * Northern Powergrid Data Fetcher (with Puppeteer)
 * Scrapes power cuts from their interactive map/table
 * Uses browser automation to handle React-based interface
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

// Supabase client with WebSocket transport for Node.js 20
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

// Navigate directly to the embedded iframe — bypasses the disclaimer modal on the main page
const NORTHERN_POWERGRID_URL = 'https://power.northernpowergrid.com/Powercuts/map?code=181';

/**
 * Fetch data using Puppeteer browser automation
 */
async function fetchWithPuppeteer() {
  let browser;
  try {
    console.log('🌐 Launching browser...\n');

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });

    console.log(`📡 Navigating to ${NORTHERN_POWERGRID_URL}...\n`);

    // Navigate to page with timeout
    await page.goto(NORTHERN_POWERGRID_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('⏳ Waiting for map to load...');
    await new Promise(r => setTimeout(r, 3000));

    // Step 3: Wait for MAP/TABLE controls then click TABLE
    console.log('⏳ Waiting for MAP/TABLE controls to render...');
    try {
      await page.waitForFunction(() => {
        const buttons = document.querySelectorAll('button');
        return Array.from(buttons).some(b => b.textContent.toUpperCase().includes('TABLE'));
      }, { timeout: 15000 });
      console.log('✅ MAP/TABLE buttons found');
    } catch (err) {
      console.log('⚠️  MAP/TABLE controls not found within timeout, continuing...');
    }

    console.log('📊 Clicking TABLE button...');
    try {
      const tableButtonClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (let btn of buttons) {
          if (btn.textContent.toUpperCase().includes('TABLE')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (tableButtonClicked) {
        console.log('✅ Clicked TABLE button');
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.log('⚠️  TABLE button not found, table view may already be active');
      }
    } catch (err) {
      console.log(`ℹ️  TABLE button click: ${err.message}`);
    }

    // Step 4: Wait for table element to appear (may be empty if no active outages)
    console.log('⏳ Waiting for table to render...');
    try {
      await page.waitForSelector('table', { timeout: 15000 });
      console.log('✅ Table rendered\n');
    } catch (err) {
      console.log('⚠️  Table not found within timeout, extracting anyway...\n');
    }

    // Step 5: Extract data — page uses div-based grid, not <table>, so parse innerText
    console.log('📋 Extracting power cut data...\n');

    const outages = await page.evaluate(() => {
      const lines = document.body.innerText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l);

      // Advance past the column header row
      const headerIdx = lines.findIndex(l => l === 'PROPERTIES AFFECTED');
      const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

      const isReference  = l => /^(INCD-|PPCR)/.test(l);
      const isDate       = l => /^\d{1,2} [A-Z][a-z]+ \d{4}/.test(l);
      const isProperties = l => /^\d+$/.test(l) || /^less than \d+/i.test(l);

      const results = [];
      let i = 0;

      while (i < dataLines.length) {
        if (!isReference(dataLines[i])) { i++; continue; }

        const reference = dataLines[i++];
        if (i >= dataLines.length) break;

        const category    = dataLines[i++];
        const startTime   = (i < dataLines.length && isDate(dataLines[i]))       ? dataLines[i++] : '';
        const approxEndTime = (i < dataLines.length && isDate(dataLines[i]))     ? dataLines[i++] : '';

        const postcodeLines = [];
        while (i < dataLines.length && !isReference(dataLines[i]) && !isProperties(dataLines[i])) {
          postcodeLines.push(dataLines[i++]);
        }

        const propertiesAffected = (i < dataLines.length && isProperties(dataLines[i])) ? dataLines[i++] : '';

        results.push({
          reference,
          category,
          startTime,
          approxEndTime,
          postcodesAffected: postcodeLines.join(', '),
          propertiesAffected,
        });
      }

      return results;
    });

    await browser.close();
    return outages;

  } catch (err) {
    if (browser) {
      await browser.close();
    }
    throw err;
  }
}

/**
 * Normalize Northern Powergrid data to our schema
 */
function normalizeNorthernPowergridRecord(outage) {
  // Parse postcode from affected postcodes
  const postcodesText = outage.postcodesAffected || '';
  const postcodes = postcodesText
    .split(/[,;]/)
    .map(p => p.trim())
    .filter(p => p && p !== 'more');

  const postcodeArea = postcodes.length > 0
    ? postcodes[0].substring(0, 4)
    : null;

  // Determine outage type — check 'unplanned' first to avoid matching the substring in "Unplanned power cut"
  const categoryLower = outage.category.toLowerCase();
  const outageType = categoryLower.includes('unplanned') ? 'unplanned'
                   : categoryLower.includes('planned') ? 'planned'
                   : 'unplanned';

  // Parse customer count
  const customersMatch = outage.propertiesAffected.match(/\d+/);
  const customersAffected = customersMatch ? parseInt(customersMatch[0]) : 0;

  // Parse timestamps
  const startTime = outage.startTime ? new Date(outage.startTime).toISOString() : new Date().toISOString();
  const estimatedRestoration = outage.approxEndTime
    ? new Date(outage.approxEndTime).toISOString()
    : null;

  return {
    dno: 'Northern Powergrid',
    dno_fault_id: ((outage.reference || '') + '').substring(0, 100),
    outage_type: outageType,
    severity: null,
    affected_postcode_area: postcodeArea,
    affected_postcodes: postcodes,
    customers_affected: customersAffected,
    location_description: outage.postcodesAffected.substring(0, 500),
    lat: null, // Would need postcode lookup
    lon: null,
    start_time: startTime,
    estimated_restoration_time: estimatedRestoration,
    actual_restoration_time: null,
    expected_duration_minutes: null,
    cause: outage.category,
    fault_description: `Northern Powergrid: ${outage.category}`,
    reference_number: ((outage.reference || '') + '').substring(0, 100),
    source_url: 'https://www.northernpowergrid.com/power-cuts-map',
    status: outage.category.toLowerCase().includes('restored') ? 'resolved' : 'active',
    raw_data: outage,
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
    console.log('🚀 Northern Powergrid Data Fetcher - Browser Automation\n');
    console.log('='.repeat(60) + '\n');

    // Fetch with Puppeteer
    const outages = await fetchWithPuppeteer();
    console.log(`✅ Extracted ${outages.length} outages from table\n`);

    if (outages.length === 0) {
      console.log('⚠️  No outages found in table.');
      console.log('   This may mean no active outages, or table structure changed.\n');
      process.exit(0);
    }

    console.log(`📋 Processing ${outages.length} outages...\n`);

    let successCount = 0;
    let errorCount = 0;
    const sampleOutages = [];

    for (let i = 0; i < outages.length; i++) {
      try {
        // Skip empty rows and sub-rows (postcode district codes like DN16, SR1)
        // Valid references always start with INCD- or PPCR
        if (!outages[i].reference) continue;
        if (!/^(INCD-|PPCR)/.test(outages[i].reference)) continue;

        // Normalize the record
        const normalized = normalizeNorthernPowergridRecord(outages[i]);

        // Insert into database
        const result = await insertOutage(normalized);

        successCount++;

        // Keep first 3 for display
        if (sampleOutages.length < 3) {
          sampleOutages.push({
            dno_fault_id: normalized.dno_fault_id,
            location: normalized.location_description,
            customers: normalized.customers_affected,
            category: normalized.cause,
            start: normalized.start_time,
          });
        }
      } catch (err) {
        console.error(`❌ Error processing outage: ${err.message}`);
        errorCount++;
      }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('\n📊 INGESTION SUMMARY\n');
    console.log(`✅ Successfully inserted: ${successCount} outages`);
    console.log(`❌ Failed: ${errorCount} outages`);
    console.log(`⏱️  Duration: ${Date.now() - startTime}ms\n`);

    if (sampleOutages.length > 0) {
      console.log('📌 SAMPLE OUTAGES INGESTED:\n');
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Reference: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location}`);
        console.log(`   Customers: ${outage.customers}`);
        console.log(`   Category: ${outage.category}`);
        console.log(`   Started: ${new Date(outage.start).toLocaleString()}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ Northern Powergrid data ingestion complete!\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check network connection');
    console.error('2. Verify page URL is correct');
    console.error('3. Increase timeout if page loads slowly');
    console.error('4. Check if Northern Powergrid website structure changed\n');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  fetchWithPuppeteer,
  normalizeNorthernPowergridRecord,
  insertOutage,
};
