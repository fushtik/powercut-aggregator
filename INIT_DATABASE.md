# Initialize Supabase Database Schema

This guide walks you through creating the database tables for the Power Cut Aggregator.

## Quick Start (Recommended)

### Step 1: Open Supabase SQL Editor

1. Go to your Supabase project dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 2: Copy and Paste Schema

Copy the contents of `src/db/schema.sql` and paste it into the SQL Editor query box.

### Step 3: Execute

Click the **Run** button (or press `Ctrl+Enter` / `Cmd+Enter`)

You should see:
```
✅ Success
```

All tables will be created automatically!

---

## What Gets Created

The schema creates 4 tables:

### 1. **outages** (Main table)
- Stores outage records from all 14 DNOs
- 23 columns including location, timing, severity, DNO references
- Indexes for fast queries (status, postcode, timestamp, etc.)
- UNIQUE constraint on (dno, dno_fault_id) to prevent duplicates

### 2. **outage_history** (Audit trail)
- Tracks changes to outages over time
- Records when ETA changed, status changed, etc.
- Used for trend analysis and audit trails

### 3. **postcode_cache** (Performance optimization)
- Caches postcode-to-DNO mappings
- Speeds up location-based lookups
- Prevents repeated external API calls

### 4. **data_fetch_log** (Monitoring)
- Logs every data fetch operation
- Tracks success/failure, execution time
- Helps debug scraping issues

---

## Verify Tables Were Created

After running the schema SQL, verify everything worked:

1. Go to **Table Editor** in Supabase
2. You should see 4 tables:
   - `outages`
   - `outage_history`
   - `postcode_cache`
   - `data_fetch_log`

---

## Next Steps

Once tables are created:

1. Test the connection from Node.js
2. Build the UKPN API fetcher
3. Set up cron job for periodic data updates
4. Build REST API endpoints

---

## Troubleshooting

### "Extension already exists"
This is fine — Supabase may already have uuid-ossp enabled. The `CREATE EXTENSION IF NOT EXISTS` handles this.

### "Relation already exists"
Tables already exist. Either:
- Skip schema creation
- Drop and recreate (careful with production data!)

### Connection errors
Make sure you're using the **Service Role Secret Key** (not the Anon key) and the correct project URL.

