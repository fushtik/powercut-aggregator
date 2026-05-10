# ⚡ Execute Schema NOW - Quick Guide

## You are here: 🔄 Creating database tables

Your Supabase database is set up. Now you need to create the tables.

---

## 5-Minute Process

### Step 1: Copy the Schema File
Open this file in your editor:
```
src/db/schema.sql
```

Select all (Cmd+A) and copy (Cmd+C).

### Step 2: Go to Supabase SQL Editor
1. Open: https://app.supabase.com
2. Click on your project
3. In left sidebar: **SQL Editor**
4. Click **New Query** (or + button)

### Step 3: Paste the Schema
In the query box, paste (Cmd+V) the entire contents of schema.sql

You'll see a large SQL block with:
- `CREATE EXTENSION IF NOT EXISTS...`
- `CREATE TABLE IF NOT EXISTS outages...`
- `CREATE TABLE IF NOT EXISTS outage_history...`
- etc.

### Step 4: Run the Query
Click the **Run** button (or press Cmd+Enter)

### Step 5: Handle the RLS Warning
A dialog appears saying:
> "Potential issue detected with your query"
> "New tables will not have Row Level Security enabled"

Click: **"Run without RLS"**

(We'll add RLS later when building the public API. For MVP, this is fine.)

### Step 6: Wait for Success
You should see:
```
✅ Success
```

Takes about 5-10 seconds.

### Step 7: Verify Tables
1. In Supabase, click **Table Editor** (left sidebar)
2. You should see 4 new tables:
   - ✅ `outages`
   - ✅ `outage_history`
   - ✅ `postcode_cache`
   - ✅ `data_fetch_log`

---

## Done! ✅

Once you see all 4 tables in Table Editor, the schema is successfully created.

---

## Troubleshooting

### "Extension already exists"
✅ This is fine. Continue.

### "Relation already exists"
✅ Tables already exist. Done!

### Nothing happened / No success message
- Check if Supabase project is running (status page)
- Try running again
- Check browser console for errors (F12)

### "Permission denied"
Make sure you're using **Service Role Secret Key**, not the Anon key:
- Project Settings → API
- Copy "Service Role Secret" (long string starting with `eyJ...`)

---

## What This Creates

| Table | Purpose |
|-------|---------|
| **outages** | All power cut records (23 columns) |
| **outage_history** | Track changes over time |
| **postcode_cache** | Speed up postcode lookups |
| **data_fetch_log** | Monitor data fetches |

---

## Next After Schema ✨

Once tables exist:

1. **Create .env file** with your Supabase credentials:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key-here
```

2. **Test connection**:
```bash
node src/db/test-connection.js
```

3. **Build UKPN API fetcher** to start ingesting real outage data

---

## Links

- Supabase Dashboard: https://app.supabase.com
- SQL Editor: https://app.supabase.com/project/[your-id]/sql/new
- Schema File: `src/db/schema.sql`
- Full Guide: `SUPABASE_SCHEMA_SETUP.md`

---

## Questions?

Check these files in order:
1. `SUPABASE_SCHEMA_SETUP.md` - Detailed troubleshooting
2. `INIT_DATABASE.md` - Alternative methods
3. `SETUP_CHECKLIST.md` - Full project progress

---

## Go execute it now! 🚀

👉 Open https://app.supabase.com → SQL Editor → New Query → Paste schema.sql → Run → "Run without RLS"

Back here when done ✅
