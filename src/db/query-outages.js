#!/usr/bin/env node

/**
 * Query Outages from Database
 * Display all outage data with full details
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function queryOutages() {
  try {
    console.log('\n📊 QUERYING OUTAGES FROM DATABASE\n');
    console.log('='.repeat(100) + '\n');

    // Get all active outages
    const { data, error, count } = await supabase
      .from('outages')
      .select('*')
      .eq('status', 'active')
      .order('customers_affected', { ascending: false })
      .limit(10);

    if (error) {
      throw error;
    }

    console.log(`📋 Found ${count} active outages (showing first 10)\n`);

    data.forEach((outage, i) => {
      console.log(`${i + 1}. ${outage.dno_fault_id}`);
      console.log(`   DNO: ${outage.dno}`);
      console.log(`   Type: ${outage.outage_type}`);
      console.log(`   Location: ${outage.location_description}`);
      console.log(`   Postcode Area: ${outage.affected_postcode_area}`);
      console.log(`   Postcodes: ${outage.affected_postcodes?.join(', ') || 'N/A'}`);
      console.log(`   Customers Affected: ${outage.customers_affected}`);
      console.log(`   Geopoint: (${outage.lat}, ${outage.lon})`);
      console.log(`   Started: ${new Date(outage.start_time).toLocaleString()}`);
      console.log(`   ETA Restoration: ${outage.estimated_restoration_time ? new Date(outage.estimated_restoration_time).toLocaleString() : 'Unknown'}`);
      console.log(`   Cause: ${outage.cause || 'N/A'}`);
      console.log(`   📝 FULL MESSAGE:\n      ${outage.fault_description || 'N/A'}`);
      console.log('\n' + '-'.repeat(100) + '\n');
    });

    // Statistics
    console.log('\n📊 OUTAGE STATISTICS\n');
    const { data: stats } = await supabase
      .from('outages')
      .select('dno, outage_type, customers_affected')
      .eq('status', 'active');

    if (stats && stats.length > 0) {
      const totalCustomers = stats.reduce((sum, o) => sum + (o.customers_affected || 0), 0);
      const byDNO = {};
      const byType = { planned: 0, unplanned: 0 };

      stats.forEach(o => {
        if (!byDNO[o.dno]) byDNO[o.dno] = 0;
        byDNO[o.dno]++;
        byType[o.outage_type] = (byType[o.outage_type] || 0) + 1;
      });

      console.log(`Total Active Outages: ${stats.length}`);
      console.log(`Total Customers Affected: ${totalCustomers.toLocaleString()}`);
      console.log(`\nBy DNO:`);
      Object.entries(byDNO).forEach(([dno, count]) => {
        console.log(`  ${dno}: ${count}`);
      });
      console.log(`\nBy Type:`);
      console.log(`  Planned: ${byType.planned}`);
      console.log(`  Unplanned: ${byType.unplanned}`);
    }

    console.log('\n' + '='.repeat(100) + '\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

queryOutages();
