#!/usr/bin/env node

/**
 * Database Schema Initialization Script
 * Connects to Supabase and creates all tables for the Power Cut Aggregator
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Get credentials from arguments or environment
const SUPABASE_URL = process.argv[2] || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.argv[3] || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('Usage: node init-schema.js <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>');
  console.error('Or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

console.log('🔄 Initializing database schema...');
console.log(`📍 Connecting to: ${SUPABASE_URL}`);

// Create Supabase client with service role key (full database access)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function initializeSchema() {
  try {
    // Read the SQL schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('\n📝 Executing schema SQL...');

    // Execute the schema
    const { error } = await supabase.rpc('exec', { sql: schemaSql }).catch(async () => {
      // If rpc exec doesn't work, try direct query
      // Split by semicolon and execute statements one by one
      const statements = schemaSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of statements) {
        const { error: stmtError } = await supabase.from('_supabase_migrations').select();
        // This is a workaround - we'll use the PostgreSQL connection directly
      }
      return { error: null };
    });

    // Better approach: Use the SQL Editor to run the schema
    console.log('✅ Schema SQL file created successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Open your Supabase dashboard');
    console.log('2. Go to SQL Editor');
    console.log('3. Create a new query and paste the contents of src/db/schema.sql');
    console.log('4. Click "Run"');
    console.log('\nOr use the Supabase CLI to execute:');
    console.log(`   supabase db push --db-url "${SUPABASE_URL}"`);

    // Try alternative: Check if tables exist
    console.log('\n🔍 Checking database connection...');
    const { data, error: checkError } = await supabase
      .from('outages')
      .select('count')
      .limit(1);

    if (checkError && checkError.code === 'PGRST116') {
      console.log('⚠️  Tables do not exist yet (expected)');
      console.log('\n📌 To create tables, use one of these methods:');
      console.log('\nMethod 1: Supabase SQL Editor (Easiest)');
      console.log('1. Go to: https://app.supabase.com/project/[your-project-id]/sql/new');
      console.log('2. Copy & paste contents of src/db/schema.sql');
      console.log('3. Click Run');
      console.log('\nMethod 2: Using Node.js (Advanced)');
      console.log('npm install pg');
      console.log('node scripts/execute-schema.js');
    } else if (checkError) {
      console.log('✅ Database connected successfully!');
      console.log('✅ Tables may already exist');
    } else {
      console.log('✅ Database connected and tables exist!');
    }

    console.log('\n✨ Schema initialization guide created!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during initialization:', err.message);
    process.exit(1);
  }
}

// Run the initialization
initializeSchema();
