#!/usr/bin/env node

/**
 * Test Supabase Database Connection
 * Verifies that Node.js can connect to the database
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Get credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Error: Missing Supabase credentials\n');
  console.error('Please create a .env file in your project root with:\n');
  console.error('SUPABASE_URL=https://your-project-id.supabase.co');
  console.error('SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n');
  console.error('You can get these from: Supabase → Project Settings → API\n');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testConnection() {
  try {
    console.log('\n🔄 Testing Supabase connection...\n');
    console.log(`📍 URL: ${SUPABASE_URL}\n`);

    // Test 1: Check server connection by querying outages table
    console.log('Test 1: Testing server connection...');
    const { data: testData, error: testError } = await supabase
      .from('outages')
      .select('count(*)', { count: 'exact', head: true });

    if (testError) {
      throw testError;
    }

    console.log('✅ Server connection successful\n');

    // Test 2: Check if tables exist
    console.log('Test 2: Checking database tables...\n');

    const tables = ['outages', 'outage_history', 'postcode_cache', 'data_fetch_log'];
    let allTablesExist = true;

    for (const tableName of tables) {
      try {
        const { data, error, count } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true });

        if (error) {
          if (error.code === 'PGRST116') {
            console.log(`❌ ${tableName}: Table does not exist`);
            allTablesExist = false;
          } else {
            console.log(`⚠️  ${tableName}: ${error.message}`);
          }
        } else {
          console.log(`✅ ${tableName}: OK (${count || 0} rows)`);
        }
      } catch (err) {
        console.log(`⚠️  ${tableName}: ${err.message}`);
        allTablesExist = false;
      }
    }

    if (allTablesExist) {
      console.log('\n✨ Database connection successful!');
      console.log('\n📊 All tables exist and are accessible.\n');
      console.log('✅ Ready to start building data fetchers!\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tables are missing.');
      console.log('Make sure you executed the schema in Supabase SQL Editor.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ Connection test failed:\n');
    console.error(err.message);
    console.error('\nTroubleshooting:');
    console.error('1. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are correct');
    console.error('2. Check that your Supabase project is running');
    console.error('3. Verify you executed the schema SQL in Supabase');
    console.error('4. Check your network connection\n');
    process.exit(1);
  }
}

testConnection();
