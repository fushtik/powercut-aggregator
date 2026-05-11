#!/usr/bin/env node

/**
 * SP Energy Networks Data Fetcher - Browser Automation
 * Coverage: SP Manweb (Wales/Cheshire) and SP Distribution (Midlands)
 * Uses Puppeteer to scrape their live power cuts page
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

/**
 * Extract outages from the current page state.
 * Tries DOM-based extraction (incident links) first, falls back to text parsing.
 */
async function extractOutagesFromPage(page) {
  return await page.evaluate(() => {
    const results = [];

    // Strategy 1: DOM-based — find "View incident" links, use their IDs
    const incidentLinks = Array.from(document.querySelectorAll('a'))
      .filter(a => a.href && a.href.includes('/incident/'));

    if (incidentLinks.length > 0) {
      incidentLinks.forEach(link => {
        const idMatch = link.href.match(/\/incident\/([^\/\?]+)/);
        const incidentId = idMatch ? idMatch[1] : null;

        // Walk up the DOM to find the card container
        let container = link.parentElement;
        for (let i = 0; i < 6 && container.parentElement; i++) {
          container = container.parentElement;
          const tag = container.tagName.toLowerCase();
          if (tag === 'li' || tag === 'article' || tag === 'section') break;
          const cls = container.className || '';
          if (cls.match(/card|item|outage|fault|incident/i)) break;
        }

        const cardText = container.innerText || '';
        const lines = cardText.split('\n').map(l => l.trim()).filter(l => l);

        const outage = { incidentId, fullText: cardText };
        const postcodeAreaPattern = /^([A-Z]{1,2}\d{1,2})$/;

        for (const line of lines) {
          if (postcodeAreaPattern.test(line) && !outage.postcodeArea) {
            outage.postcodeArea = line;
          }

          const postcodeCount = line.match(/^(\d+)\s+Postcode/i);
          if (postcodeCount) outage.postcodesAffected = parseInt(postcodeCount[1]);

          const restored = line.match(/^Restored:\s*(.+)$/i);
          if (restored) { outage.restoredTime = restored[1]; outage.status = 'restored'; }

          const estimated = line.match(/^Estimated time to restore:\s*(.+)$/i);
          if (estimated) { outage.estimatedTime = estimated[1]; outage.status = 'in_progress'; }

          if (line === line.toUpperCase() && line.length > 2 && !/\d/.test(line) &&
              !line.includes(':') && !postcodeAreaPattern.test(line)) {
            outage.location = line;
          }
        }

        if (outage.postcodeArea || outage.incidentId) {
          results.push(outage);
        }
      });

      return results;
    }

    // Strategy 2: Text-based parsing fallback
    const pageText = document.body.innerText;
    const lines = pageText.split('\n');

    let currentOutage = null;
    const postcodeAreaPattern = /^([A-Z]{1,2}\d{1,2})$/;
    const stopPatterns = /^[<>12345678910]$|^View incident|^Power cuts help|^Information on|^Become a|^Contact us|^Accessibility|^Emergency|^Quick links|^Online form|^Social media|^©|^Site Map|^ISO|^Careers|^Policies|^Legal|^Privacy|^Cookies|^If you need|^0330|^Have a look/i;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (postcodeAreaPattern.test(line)) {
        if (currentOutage) results.push(currentOutage);
        currentOutage = { postcodeArea: line, fullText: line };
        continue;
      }

      if (!currentOutage) continue;

      if (stopPatterns.test(line)) {
        results.push(currentOutage);
        currentOutage = null;
        continue;
      }

      const postcodeCount = line.match(/^(\d+)\s+Postcode/i);
      if (postcodeCount) {
        currentOutage.postcodesAffected = parseInt(postcodeCount[1]);
        currentOutage.fullText += '\n' + line;
        continue;
      }

      if (line === line.toUpperCase() && line.length > 2 && !/\d/.test(line) && !line.includes(':')) {
        currentOutage.location = line;
        currentOutage.fullText += '\n' + line;
        continue;
      }

      const restored = line.match(/^Restored:\s*(.+)$/i);
      if (restored) {
        currentOutage.restoredTime = restored[1];
        currentOutage.status = 'restored';
        currentOutage.fullText += '\n' + line;
        continue;
      }

      const estimated = line.match(/^Estimated time to restore:\s*(.+)$/i);
      if (estimated) {
        currentOutage.estimatedTime = estimated[1];
        currentOutage.status = 'in_progress';
        currentOutage.fullText += '\n' + line;
        continue;
      }

      currentOutage.fullText += '\n' + line;
    }

    if (currentOutage) results.push(currentOutage);
    return results;
  });
}

/**
 * Fetch SP Energy outages via browser automation
 */
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

    console.log('📡 Navigating to SP Energy power cuts list...\n');
    await page.goto('https://powercuts.spenergynetworks.co.uk/list', { waitUntil: 'networkidle2' });

    console.log('⏳ Waiting for page to render...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const allOutages = [];
    let pageNum = 1;

    while (true) {
      const outages = await extractOutagesFromPage(page);
      console.log(`✅ Extracted ${outages.length} outage entries from page ${pageNum}`);
      allOutages.push(...outages);

      // Try to click the next page number
      const nextPage = pageNum + 1;
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
        console.log(`📄 No page ${nextPage} found, all pages collected\n`);
        break;
      }

      console.log(`📄 Clicking page ${nextPage}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      pageNum = nextPage;
    }

    await browser.close();
    return allOutages;
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

/**
 * Parse SP Energy's date format: "11 May 2026, 1.00am" / "10 May 2026, 11.00pm"
 */
function parseSpEnergyDate(str) {
  if (!str) return null;
  const match = str.match(/(\d+)\s+(\w+)\s+(\d{4}),\s*(\d+)\.(\d+)\s*(am|pm)/i);
  if (!match) return null;
  const [, day, month, year, hourStr, min, ampm] = match;
  let hour = parseInt(hourStr);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  const date = new Date(`${day} ${month} ${year} ${String(hour).padStart(2, '0')}:${min}:00`);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Build a stable fault ID for an SP Energy record.
 * Uses incident ID from DOM if available, otherwise composite of postcode + ETR date.
 */
function buildFaultId(record) {
  if (record.incidentId) return `SPE-${record.incidentId}`;

  const area = (record.postcodeArea || '').replace(/\s+/g, '');
  if (!area) return null;

  // Use ETR date or restoration date to make composite ID stable across runs
  const timeRef = record.estimatedTime || record.restoredTime || '';
  if (timeRef) {
    // Extract date portion only (e.g. "11 May 2026" from "11 May 2026, 1.00am")
    const dateMatch = timeRef.match(/\d+\s+\w+\s+\d{4}/);
    if (dateMatch) return `${area}_${dateMatch[0].replace(/\s+/g, '-')}`;
  }

  return area;
}

/**
 * Normalize SP Energy record to our schema
 */
function normalizeSPEnergyRecord(record) {
  const faultId = buildFaultId(record);
  const postcodeArea = (record.postcodeArea || '').substring(0, 10);

  const isPlanned = (record.status || '').toLowerCase().includes('planned') ||
                    (record.fullText || '').toLowerCase().includes('maintenance');

  const estimatedTime = parseSpEnergyDate(record.estimatedTime);
  const actualRestoration = parseSpEnergyDate(record.restoredTime);

  const locationDesc = [record.location, postcodeArea].filter(Boolean).join(', ').substring(0, 255);

  return {
    dno: 'SPE',
    dno_fault_id: (faultId || '').substring(0, 100),
    outage_type: isPlanned ? 'planned' : 'unplanned',
    severity: null,
    affected_postcode_area: postcodeArea || null,
    affected_postcodes: postcodeArea ? [postcodeArea] : [],
    customers_affected: 0,  // SP Energy list page doesn't expose customer counts
    location_description: locationDesc || 'SP Energy Networks',
    lat: null,
    lon: null,
    start_time: new Date().toISOString(),  // Not exposed on list page
    estimated_restoration_time: estimatedTime,
    actual_restoration_time: actualRestoration,
    expected_duration_minutes: null,
    cause: isPlanned ? 'Planned maintenance' : 'Unplanned outage',
    fault_description: null,  // fullText is noisy (loading artefacts, duplicates ETR/location)
    reference_number: (faultId || '').substring(0, 100),
    source_url: 'https://powercuts.spenergynetworks.co.uk/list',
    status: (record.status || '').toLowerCase().includes('restored') ? 'resolved' : 'active',
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

/**
 * Insert outage into database
 */
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

/**
 * Main workflow
 */
async function main() {
  const startTime = Date.now();

  try {
    console.log('🚀 SP Energy Networks Data Fetcher - Browser Automation\n');
    console.log('='.repeat(60) + '\n');

    const records = await fetchSPEnergyData();

    if (records.length === 0) {
      console.log('⚠️  No outages found on the page.\n');
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
        if (!record.fullText || record.fullText.trim().length < 3) continue;

        const normalized = normalizeSPEnergyRecord(record);
        if (!normalized.dno_fault_id) continue;

        activeFaultIds.add(normalized.dno_fault_id);
        await insertOutage(normalized);
        successCount++;

        if (sampleOutages.length < 3) {
          sampleOutages.push(normalized);
        }
      } catch (err) {
        console.error(`❌ Error processing record ${idx + 1}: ${err.message}`);
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
      sampleOutages.forEach((outage, i) => {
        console.log(`${i + 1}. Fault ID: ${outage.dno_fault_id}`);
        console.log(`   Location: ${outage.location_description}`);
        console.log(`   Status: ${outage.status}`);
        console.log(`   ETR: ${outage.estimated_restoration_time || outage.actual_restoration_time || 'Unknown'}\n`);
      });
    }

    console.log('='.repeat(60));
    console.log('\n✨ SP Energy data ingestion complete!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FATAL ERROR\n');
    console.error(`${err.message}\n`);
    console.error('Troubleshooting:');
    console.error('1. Check if Chrome/Chromium is installed');
    console.error('2. Verify SP Energy website is accessible');
    console.error('3. Check if page structure has changed\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { fetchSPEnergyData, normalizeSPEnergyRecord, insertOutage, resolveStaleOutages };
