#!/usr/bin/env node

/**
 * Execute schema SQL directly against Supabase
 * This bypasses the web UI and executes SQL statements via the JavaScript client
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Get credentials from environment or arguments
const SUPABASE_URL = process.env.SUPABASE_URL || process.argv[2];
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv[3];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('Usage: node execute-schema.js <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>');
  console.error('Or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function executeSchema() {
  try {
    console.log('🔄 Initializing database schema...');
    console.log(`📍 Connecting to: ${SUPABASE_URL}`);

    // Read the schema SQL file
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('\n📝 Schema SQL file loaded successfully');
    console.log(`   File size: ${schemaSql.length} bytes`);

    // Split into individual statements (simple approach - may need refinement for complex SQL)
    const statements = schemaSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`\n📋 Found ${statements.length} SQL statements to execute`);

    // Execute statements one by one
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const statementNum = i + 1;

      // Show progress for larger statements
      if (statement.length > 100) {
        const preview = statement.substring(0, 60).replace(/\n/g, ' ') + '...';
        console.log(`\n[${statementNum}/${statements.length}] Executing: ${preview}`);
      } else {
        console.log(`\n[${statementNum}/${statements.length}] Executing: ${statement.replace(/\n/g, ' ')}`);
      }

      try {
        // Use the admin API to execute raw SQL
        const { data, error } = await supabase.rpc('exec', {
          sql: statement
        });

        if (error) {
          // If rpc doesn't work, the error will be caught below
          throw error;
        }

        console.log(`   ✅ Success`);
        successCount++;
      } catch (err) {
        // Some statements might fail if they depend on extensions or previous statements
        // This is normal - we'll continue and check if tables exist at the end
        if (err.message.includes('does not exist') || err.message.includes('already exists')) {
          console.log(`   ⚠️  Note: ${err.message}`);
        } else {
          console.log(`   ❌ Error: ${err.message}`);
          errorCount++;
        }
      }
    }

    console.log(`\n📊 Execution Summary:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    // Verify tables exist
    console.log('\n🔍 Verifying tables were created...');

    const tablesToCheck = ['outages', 'outage_history', 'postcode_cache', 'data_fetch_log'];
    let allTablesExist = true;

    for (const tableName of tablesToCheck) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('count', { count: 'exact', head: true });

        if (error && error.code === 'PGRST116') {
          console.log(`   ❌ ${tableName}: Does not exist`);
          allTablesExist = false;
        } else if (error) {
          console.log(`   ⚠️  ${tableName}: ${error.message}`);
        } else {
          console.log(`   ✅ ${tableName}: Exists`);
        }
      } catch (err) {
        console.log(`   ⚠️  ${tableName}: Could not verify - ${err.message}`);
      }
    }

    if (allTablesExist) {
      console.log('\n✨ Database schema initialized successfully!');
      console.log('\n📋 Next steps:');
      console.log('1. Test Node.js connection: node src/db/test-connection.js');
      console.log('2. Build UKPN API data fetcher');
      console.log('3. Implement web scrapers for other DNOs');
      console.log('4. Set up cron job for periodic updates');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tables may not have been created');
      console.log('This might be due to RLS settings or extension issues.');
      console.log('Try executing the schema via Supabase SQL Editor instead:');
      console.log('1. Open https://app.supabase.com/project/[your-project-id]/sql/new');
      console.log('2. Paste the contents of src/db/schema.sql');
      console.log('3. Click "Run" and select "Run without RLS"');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

// Run the execution
executeSchema();
