# Supabase Schema Setup Guide

## Quick Start: Execute Schema in Supabase Dashboard

You need to run the schema SQL in Supabase to create all the database tables. There are two ways:

### Method 1: Supabase Web Dashboard (Recommended for First Time)

1. **Open Supabase SQL Editor**
   - Go to your Supabase project: https://app.supabase.com
   - Click on your project
   - In the left sidebar, click **SQL Editor**
   - Click **New Query** (or the + icon)

2. **Copy the Schema SQL**
   - Open the file: `src/db/schema.sql`
   - Select all the content (Cmd+A)
   - Copy it (Cmd+C)

3. **Paste into Supabase**
   - In the SQL Editor query box, paste the schema SQL
   - You'll see the full SQL schema with all table definitions

4. **Handle the RLS Warning**
   - Click the **Run** button (or Cmd+Enter)
   - A dialog will appear: "Potential issue detected with your query"
   - It will say: "New tables will not have Row Level Security enabled"
   - Click **"Run without RLS"** (we'll add RLS later when building the public API)

5. **Verify Success**
   - You should see: `✅ Success` message
   - Go to the **Table Editor** in Supabase (left sidebar)
   - Verify these 4 tables exist:
     - `outages` (main table)
     - `outage_history` (audit trail)
     - `postcode_cache` (performance cache)
     - `data_fetch_log` (fetch monitoring)

---

## Method 2: Command Line (Advanced)

If you prefer using the CLI or terminal, you can use the Supabase CLI:

```bash
# Install Supabase CLI (one time)
brew install supabase/tap/supabase

# Or use npm
npm install -g supabase

# Link your project
supabase link --project-ref your-project-id

# Push the schema
supabase db push

# Or execute raw SQL
psql postgresql://[user]:[password]@[host]:[port]/[database] < src/db/schema.sql
```

---

## Troubleshooting

### "Extension already exists"
This is fine! Supabase may already have `uuid-ossp` enabled. The `CREATE EXTENSION IF NOT EXISTS` in our schema handles this gracefully.

### "Relation already exists" 
The tables already exist. Either:
- Skip schema creation if you're re-running
- Drop and recreate (careful with production data!)

### "Permission denied"
Make sure you're using the **Service Role Secret Key**, not the Anon key:
- Get your keys from: Project Settings → API
- Service Role Secret: Has full database access (use this)
- Anon Key: Limited public access (don't use for setup)

### "Connection refused"
- Verify your Supabase project is running
- Check your database credentials
- Make sure your IP is whitelisted (if on Hostinger or restricted network)

---

## What Gets Created

### 1. **outages** Table (23 columns)
- Core table storing all outage records
- Unique constraint on (dno, dno_fault_id) to prevent duplicates
- Multiple indexes for fast queries
- Fields: location, timing, severity, customer impact, DNO references

### 2. **outage_history** Table
- Audit trail tracking changes to outages
- Records when ETA changed, status updated, etc.
- Used for trend analysis and debugging

### 3. **postcode_cache** Table
- Cache of postcode → DNO mappings
- Speeds up location-based lookups
- Prevents repeated external API calls

### 4. **data_fetch_log** Table
- Logs every data fetch operation
- Tracks success/failure, execution time
- Helps debug scraper issues

---

## After Schema Creation

Once the schema is created, here's what to do next:

### 1. Test Database Connection
```bash
node src/db/test-connection.js
```

### 2. Create .env File
Create `.env` in your project root:
```
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NODE_ENV=development
```

### 3. Build Data Fetchers
- UKPN API fetcher (has full real-time API)
- Web scrapers for other DNOs
- Normalization layer

### 4. Set Up Cron Jobs
- Periodic data updates (every 5-15 minutes)
- Stale data cleanup
- Performance optimization

### 5. Build REST API
- GET /api/outages (all active outages)
- GET /api/outages?postcode=SW1A (by postcode)
- GET /api/outages?dno=UKPN (by DNO)
- WebSocket for real-time updates

### 6. Build Frontend
- Interactive map showing outages
- Postcode search
- Real-time updates
- Statistics dashboard

---

## Database Connection Details

For Node.js, you can use either:

### Option A: Supabase Client (JavaScript)
```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase
  .from('outages')
  .select('*')
  .eq('status', 'active');
```

### Option B: PostgreSQL Pool (via pg library)
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://...'
});

const result = await pool.query('SELECT * FROM outages WHERE status = $1', ['active']);
```

---

## Security Notes

⚠️ **Important for Production:**
- Never commit `.env` file (add to `.gitignore`)
- Use Service Role Key only for backend code
- Use Anon Key in frontend code (with RLS policies)
- Enable RLS before going public
- Rotate keys regularly
- Enable backup schedules

For now (MVP), we're skipping RLS. We'll add it when building the public API.

---

## Questions?

If you encounter any issues:
1. Check Supabase project status page
2. Verify credentials are correct
3. Check database logs in Supabase dashboard
4. Try again in a new SQL Editor query

Once the schema is created, we'll move on to building the UKPN API data fetcher.
