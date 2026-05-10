#!/usr/bin/env node

/**
 * Check current database contents and identify errors
 */

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

async function checkData() {
  try {
    console.log('📊 Checking database contents...\n');

    // Get summary by DNO
    const { data: allRecords, error } = await supabase
      .from('outages')
      .select('dno, id')
      .order('dno', { ascending: true });

    if (error) throw error;

    if (!allRecords || allRecords.length === 0) {
      console.log('❌ No records found in database');
      process.exit(0);
    }

    // Count by DNO
    const byDNO = {};
    allRecords.forEach(record => {
      byDNO[record.dno] = (byDNO[record.dno] || 0) + 1;
    });

    console.log('📈 RECORDS BY DNO:\n');
    Object.entries(byDNO)
      .sort((a, b) => b[1] - a[1])
      .forEach(([dno, count]) => {
        console.log(`   ${dno}: ${count} records`);
      });

    const totalCount = allRecords.length;
    console.log(`\n   TOTAL: ${totalCount} records\n`);

    // Get ENWL records specifically (if any exist)
    const { data: enwlRecords } = await supabase
      .from('outages')
      .select('*')
      .eq('dno', 'ENWL');

    if (enwlRecords && enwlRecords.length > 0) {
      console.log('⚠️  ENWL RECORDS FOUND (should be empty until API key available):\n');
      enwlRecords.slice(0, 3).forEach((record, idx) => {
        console.log(`Record ${idx + 1}:`);
        console.log(`  ID: ${record.id}`);
        console.log(`  Fault ID: ${record.dno_fault_id}`);
        console.log(`  Location: ${record.location_description?.substring(0, 80)}`);
        console.log(`  Description: ${record.fault_description?.substring(0, 80)}`);
        console.log();
      });
      console.log(`⚠️  Total ENWL records: ${enwlRecords.length}`);
      console.log('\n💡 These should be cleaned up before ENWL API integration\n');
    }

    // Check Northern Powergrid
    const { data: npgRecords } = await supabase
      .from('outages')
      .select('*')
      .eq('dno', 'Northern Powergrid');

    if (!npgRecords || npgRecords.length === 0) {
      console.log('⚠️  Northern Powergrid: 0 records (table structure may have changed)\n');
    } else {
      console.log(`✅ Northern Powergrid: ${npgRecords.length} records\n`);
    }

    // Look for suspicious data patterns
    const { data: allData } = await supabase
      .from('outages')
      .select('location_description, fault_description');

    let suspiciousCount = 0;
    const suspiciousPatterns = ['Page Down', 'Jump down', 'keyboard', 'navigation'];

    allData?.forEach(record => {
      const text = (record.location_description || '') + ' ' + (record.fault_description || '');
      if (suspiciousPatterns.some(pattern => text.includes(pattern))) {
        suspiciousCount++;
      }
    });

    if (suspiciousCount > 0) {
      console.log(`⚠️  Found ${suspiciousCount} records with suspicious text patterns (keyboard navigation, etc.)\n`);
    }

    console.log('='.repeat(60));
    console.log('\n✨ Data check complete\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  checkData();
}

module.exports = { checkData };
