#!/usr/bin/env node

/**
 * Clean up problematic database records
 * Specifically: ENWL records with bad data from puppeteer scraper
 */

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

async function cleanupData() {
  try {
    console.log('🧹 Starting database cleanup...\n');

    // First, check what we're deleting
    const { data: enwlRecords } = await supabase
      .from('outages')
      .select('id, dno_fault_id, location_description')
      .eq('dno', 'ENWL');

    if (!enwlRecords || enwlRecords.length === 0) {
      console.log('✅ No ENWL records found - database is clean\n');
      process.exit(0);
    }

    console.log(`⚠️  Found ${enwlRecords.length} ENWL records to delete:\n`);
    enwlRecords.slice(0, 5).forEach((record, idx) => {
      console.log(`${idx + 1}. ID: ${record.id}`);
      console.log(`   Fault ID: ${record.dno_fault_id}`);
      console.log(`   Location: ${record.location_description?.substring(0, 60)}`);
    });

    if (enwlRecords.length > 5) {
      console.log(`... and ${enwlRecords.length - 5} more\n`);
    } else {
      console.log();
    }

    console.log('🔴 Deleting ENWL records...');

    const { error } = await supabase
      .from('outages')
      .delete()
      .eq('dno', 'ENWL');

    if (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }

    console.log(`✅ Deleted ${enwlRecords.length} ENWL records\n`);

    // Verify deletion
    const { data: verify } = await supabase
      .from('outages')
      .select('id')
      .eq('dno', 'ENWL');

    if (verify && verify.length === 0) {
      console.log('✅ Verification: ENWL records successfully removed\n');
    } else {
      console.log(`⚠️  Verification warning: Still found ${verify?.length || 0} ENWL records\n`);
    }

    // Get final count by DNO
    const { data: finalCount } = await supabase
      .from('outages')
      .select('dno, id')
      .order('dno', { ascending: true });

    const byDNO = {};
    finalCount?.forEach(record => {
      byDNO[record.dno] = (byDNO[record.dno] || 0) + 1;
    });

    console.log('📊 DATABASE STATUS AFTER CLEANUP:\n');
    Object.entries(byDNO)
      .sort((a, b) => b[1] - a[1])
      .forEach(([dno, count]) => {
        console.log(`   ${dno}: ${count} records`);
      });

    const totalCount = finalCount?.length || 0;
    console.log(`\n   TOTAL: ${totalCount} records\n`);

    console.log('='.repeat(60));
    console.log('\n✨ Cleanup complete\n');

  } catch (err) {
    console.error('\n❌ Error during cleanup:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  cleanupData();
}

module.exports = { cleanupData };
