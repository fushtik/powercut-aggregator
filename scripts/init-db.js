#!/usr/bin/env node

/**
 * Initialize database schema via direct PostgreSQL connection
 * Works with Supabase or any PostgreSQL database
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config(path.join(__dirname, '../.env'));

// Try using pg library if available, otherwise fall back to Supabase
let pool;
try {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
  console.log('✅ Using pg library for direct PostgreSQL connection');
} catch (e) {
  // Fall back to Supabase
  const { createClient } = require('@supabase/supabase-js');
  console.log('✅ Using Supabase client');
  // We'll handle this below
}

async function executeSchema() {
  try {
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('🔄 Initializing database schema...');
    console.log(`📋 Schema file size: ${schemaSql.length} bytes\n`);

    if (pool) {
      // Using pg library
      const client = await pool.connect();
      try {
        console.log('📝 Executing schema SQL...\n');
        const result = await client.query(schemaSql);
        console.log('✅ Schema executed successfully!\n');

        // Verify tables
        console.log('🔍 Verifying tables...');
        const tableResult = await client.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);

        console.log('\n📋 Created tables:');
        tableResult.rows.forEach(row => {
          console.log(`   ✅ ${row.table_name}`);
        });

        console.log('\n✨ Database initialization complete!');
        process.exit(0);
      } finally {
        client.release();
      }
    } else {
      // Using Supabase
      const { createClient } = require('@supabase/supabase-js');
      const SUPABASE_URL = process.env.SUPABASE_URL || process.argv[2];
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv[3];

      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Execute via SQL Editor endpoint
      console.log('📝 Note: Direct SQL execution via Supabase client has limitations.');
      console.log('Please execute the schema manually via the Supabase dashboard:\n');
      console.log('1. Open: https://app.supabase.com/project/[project-id]/sql/new');
      console.log('2. Paste: ' + schemaPath);
      console.log('3. Click "Run" → "Run without RLS"\n');

      console.log('Or use the Supabase CLI:');
      console.log(`   supabase db push --db-url "postgresql://[user]:[pass]@[host]/[db]"\n`);

      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.code === 'ENOENT') {
      console.error('   Schema file not found at', schemaPath);
    }
    process.exit(1);
  }
}

executeSchema();
