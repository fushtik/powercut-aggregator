#!/usr/bin/env node

/**
 * Simple Supabase Connection Test
 * Minimal debugging
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n📍 Supabase URL:', SUPABASE_URL);
console.log('🔑 Service Role Key present:', !!SUPABASE_SERVICE_ROLE_KEY);
console.log('🔑 Service Role Key length:', SUPABASE_SERVICE_ROLE_KEY?.length);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Missing credentials in .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  try {
    console.log('\n🔄 Attempting to query outages table...\n');

    const { data, error, status, statusText } = await supabase
      .from('outages')
      .select('*')
      .limit(1);

    if (error) {
      console.log('❌ Error:', error);
      console.log('Status:', status);
      console.log('Message:', error.message);
      console.log('Code:', error.code);
      process.exit(1);
    }

    console.log('✅ Connection successful!');
    console.log('📊 Data returned:', data);
    console.log('\n✨ Database is accessible!\n');
    process.exit(0);
  } catch (err) {
    console.log('\n❌ Error:', err.message);
    console.log('\nFull error:', err);
    process.exit(1);
  }
}

test();
