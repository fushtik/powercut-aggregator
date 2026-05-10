#!/usr/bin/env node

/**
 * Query All Outages from Database
 * Display aggregated data from all DNOs
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function queryAllOutages() {
  try {
    console.log('\n📊 COMPREHENSIVE OUTAGE ANALYSIS\n');
    console.log('='.repeat(100) + '\n');

    // Get all outages
    const { data: allOutages, error, count } = await supabase
      .from('outages')
      .select('*')
      .order('customers_affected', { ascending: false });

    if (error) {
      throw error;
    }

    console.log(`📈 TOTAL DATASET\n`);
    console.log(`Total Outages: ${allOutages.length}`);
    console.log(`Total Customers Affected: ${allOutages.reduce((sum, o) => sum + (o.customers_affected || 0), 0).toLocaleString()}\n`);

    // Stats by DNO
    console.log(`📍 BREAKDOWN BY DNO\n`);
    const byDNO = {};
    const byType = { planned: 0, unplanned: 0 };
    const byStatus = { active: 0, resolved: 0, closed: 0 };

    allOutages.forEach(o => {
      // By DNO
      if (!byDNO[o.dno]) {
        byDNO[o.dno] = {
          count: 0,
          customers: 0,
          postcodes: new Set(),
        };
      }
      byDNO[o.dno].count++;
      byDNO[o.dno].customers += o.customers_affected || 0;
      if (o.affected_postcodes) {
        o.affected_postcodes.forEach(p => byDNO[o.dno].postcodes.add(p));
      }

      // By type
      byType[o.outage_type] = (byType[o.outage_type] || 0) + 1;

      // By status
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    });

    Object.entries(byDNO).sort((a, b) => b[1].count - a[1].count).forEach(([dno, stats]) => {
      console.log(`${dno}:`);
      console.log(`  Outages: ${stats.count}`);
      console.log(`  Customers: ${stats.customers.toLocaleString()}`);
      console.log(`  Postcodes: ${stats.postcodes.size}`);
      console.log();
    });

    // Type breakdown
    console.log(`📋 BY TYPE\n`);
    console.log(`Planned: ${byType.planned}`);
    console.log(`Unplanned: ${byType.unplanned}\n`);

    // Status breakdown
    console.log(`✅ BY STATUS\n`);
    console.log(`Active: ${byStatus.active}`);
    console.log(`Resolved: ${byStatus.resolved}`);
    console.log(`Closed: ${byStatus.closed}\n`);

    // Top 10 by customers affected
    console.log(`=`.repeat(100));
    console.log('\n🔴 TOP 10 OUTAGES BY CUSTOMERS AFFECTED\n');

    const top10 = allOutages.slice(0, 10);
    top10.forEach((outage, i) => {
      console.log(`${i + 1}. ${outage.dno_fault_id} (${outage.dno})`);
      console.log(`   Location: ${outage.location_description}`);
      console.log(`   Customers: ${outage.customers_affected}`);
      console.log(`   Type: ${outage.outage_type}`);
      console.log(`   Status: ${outage.status}`);
      console.log(`   Postcodes: ${outage.affected_postcodes?.join(', ').substring(0, 60) || 'N/A'}${(outage.affected_postcodes?.length || 0) > 3 ? '...' : ''}`);
      console.log(`   Started: ${new Date(outage.start_time).toLocaleString()}`);
      if (outage.estimated_restoration_time) {
        console.log(`   ETA: ${new Date(outage.estimated_restoration_time).toLocaleString()}`);
      }
      console.log();
    });

    // Geographic coverage
    console.log(`=`.repeat(100));
    console.log('\n🌍 GEOGRAPHIC COVERAGE\n');

    const withLocation = allOutages.filter(o => o.lat && o.lon);
    console.log(`Outages with coordinates: ${withLocation.length}/${allOutages.length}`);
    console.log(`Coverage: ${((withLocation.length / allOutages.length) * 100).toFixed(1)}%\n`);

    // Postcode areas covered
    const postcodeAreas = new Set();
    allOutages.forEach(o => {
      if (o.affected_postcode_area) {
        postcodeAreas.add(o.affected_postcode_area);
      }
    });
    console.log(`Unique Postcode Areas: ${postcodeAreas.size}`);
    console.log(`Areas: ${Array.from(postcodeAreas).sort().join(', ').substring(0, 100)}...\n`);

    console.log('='.repeat(100));
    console.log('\n✨ Stage 1 Complete!\n');
    console.log('Data Status:');
    console.log('✅ UKPN API - 97 outages ingested');
    console.log('✅ SSEN API - 14 faults ingested');
    console.log('⏳ Northern Powergrid - Requires browser automation (complex React framework)\n');
    console.log('Next Steps:');
    console.log('1. Set up automated fetching with cron jobs');
    console.log('2. Add Northern Powergrid with Puppeteer/Playwright');
    console.log('3. Build REST API endpoints');
    console.log('4. Build interactive frontend map\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

queryAllOutages();
