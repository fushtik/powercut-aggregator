# Power Cut Aggregator - Setup Checklist

## Phase 1: Database Setup ✅ (In Progress)

### ✅ Completed
- [x] Research all 14 UK DNO data sources
- [x] Design PostgreSQL database schema
- [x] Create schema.sql with 4 tables and indexes
- [x] Set up npm project and install Supabase dependency
- [x] Initialize Git repository and push to GitHub

### 🔄 Current Step: Execute Schema in Supabase

You are here → **Execute the schema SQL to create database tables**

**What to do:**
1. Open Supabase dashboard: https://app.supabase.com
2. Go to SQL Editor → New Query
3. Copy all content from `src/db/schema.sql`
4. Paste into the SQL Editor
5. Click "Run" 
6. Select "Run without RLS" (we'll add RLS later)
7. Verify 4 tables were created in Table Editor

**Files to help:**
- `src/db/schema.sql` - The SQL schema to execute
- `SUPABASE_SCHEMA_SETUP.md` - Detailed setup guide
- `INIT_DATABASE.md` - Alternative instructions

**Scripts available:**
```bash
# Try automatic execution (if you have DATABASE_URL set)
node scripts/init-db.js
python3 scripts/execute-schema.py
```

**Once complete:** ✅ All 4 tables exist in Supabase

---

## Phase 2: Backend Development

### Step 1: Environment Setup
- [ ] Create `.env` file with Supabase credentials
- [ ] Copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase
- [ ] Test connection: `node src/db/test-connection.js`

### Step 2: UKPN API Data Fetcher
- [ ] Build UKPN API client (they have full real-time API)
- [ ] Parse their JSON response
- [ ] Normalize data to match database schema
- [ ] Implement upsert logic (avoid duplicates)
- [ ] Handle rate limiting and retries

### Step 3: Other DNO Scrapers
- [ ] SSEN: Use their published dataset
- [ ] SEEL: Web scrape or use available data
- [ ] Western Power: Parse their feeds
- [ ] Others: Implement scrapers for remaining 10 DNOs

### Step 4: Data Aggregation Layer
- [ ] Normalization functions for each DNO format
- [ ] Postcode lookup and validation
- [ ] Geolocation (lat/lon from postcodes)
- [ ] Deduplication logic

### Step 5: Cron Jobs
- [ ] Set up periodic fetchers (every 5-15 minutes)
- [ ] Error handling and alerting
- [ ] Data quality checks
- [ ] Performance monitoring

### Step 6: REST API
- [ ] GET /api/outages - all active outages
- [ ] GET /api/outages?status=active - filter by status
- [ ] GET /api/outages?postcode=SW1A - by postcode
- [ ] GET /api/outages?dno=UKPN - by DNO
- [ ] GET /api/stats - outage statistics
- [ ] WebSocket for real-time updates
- [ ] Authentication (later phase)

---

## Phase 3: Frontend Development

### Step 1: Basic Setup
- [ ] Choose framework (React/Vue/Svelte)
- [ ] Set up project structure
- [ ] API client to backend

### Step 2: Core Features
- [ ] Interactive map (Leaflet or Mapbox)
- [ ] Real-time outage markers
- [ ] Postcode search
- [ ] DNO filtering
- [ ] Outage details panel

### Step 3: Advanced Features
- [ ] Real-time updates (WebSocket)
- [ ] Historical outage data
- [ ] Statistics dashboard
- [ ] Affected customers chart
- [ ] ETA predictions

### Step 4: Deployment
- [ ] Build optimization
- [ ] Static hosting (Netlify/Vercel)
- [ ] CDN setup
- [ ] Performance monitoring

---

## Phase 4: Operations & Monitoring

### Step 1: Monitoring
- [ ] Database query performance
- [ ] Data fetch success rates
- [ ] API response times
- [ ] Frontend performance

### Step 2: Alerting
- [ ] Failed data fetches
- [ ] High outage counts
- [ ] Database issues
- [ ] API errors

### Step 3: Maintenance
- [ ] Regular backups
- [ ] Database optimization
- [ ] Log rotation
- [ ] Security updates

---

## Technical Stack Summary

| Component | Technology | Status |
|-----------|-----------|--------|
| **Database** | PostgreSQL (Supabase) | ✅ Configured |
| **Backend** | Node.js + Express | ⏳ Next |
| **Data Source 1** | UKPN API | ⏳ To build |
| **Data Sources 2-14** | Web scraping | ⏳ To build |
| **Real-time** | WebSocket | ⏳ To build |
| **Frontend** | React (recommended) | ⏳ To build |
| **Hosting** | Hostinger VPS | ✅ Ready |
| **Deployment** | GitHub → Auto-deploy | ✅ Ready |

---

## Database Tables Created

```
outages (23 columns)
├── UUID primary key
├── DNO references (dno, dno_fault_id)
├── Classification (type, severity)
├── Location (postcode_area, postcodes[], description)
├── Timing (start_time, estimated_restoration, actual_restoration)
├── Details (cause, fault_description, reference_number)
├── Status (status, created_at, updated_at, last_verified)
└── Raw data (raw_data JSONB)

outage_history (audit trail)
├── Tracks status changes
├── Records ETA updates
├── Logs customer impact changes
└── Indexed for trend analysis

postcode_cache (performance)
├── Postcode → DNO mapping
├── Location coordinates
└── Region names

data_fetch_log (monitoring)
├── Fetch operation records
├── Success/failure tracking
├── Execution times
└── Error messages
```

---

## Important Notes

### Security
- ⚠️ Never commit `.env` file
- ⚠️ Use Service Role Key only in backend code
- ⚠️ Enable RLS before going public (Phase 4)
- ⚠️ Rotate keys regularly in production

### Performance
- Database is indexed for common queries
- Postcode cache prevents repeated lookups
- Consider pagination for large result sets
- Monitor query performance with EXPLAIN ANALYZE

### Data Quality
- UNIQUE constraint on (dno, dno_fault_id) prevents duplicates
- Validation layer before inserting data
- Postcode normalization (uppercase, format check)
- Geolocation validation

---

## Next Steps Summary

1. **RIGHT NOW:** Execute schema SQL in Supabase (see above)
2. **Next:** Create .env file with credentials
3. **Then:** Test database connection from Node.js
4. **After:** Build UKPN API data fetcher
5. **Following:** Implement scrapers for other DNOs
6. **Finally:** Build REST API and frontend

---

## Getting Help

All guides are in the project root:
- `SUPABASE_SCHEMA_SETUP.md` - Database setup guide
- `INIT_DATABASE.md` - Alternative schema setup instructions
- `POSTGRES_SETUP.md` - Detailed PostgreSQL documentation
- `DNO_DATA_SOURCES_RESEARCH.md` - Info on all 14 DNOs
- `STAGE_2_SCHEMA_DESIGN.md` - Database design details

---

## Status: 🚀 Ready for Next Phase

Once schema is executed:
```bash
# Test connection
node src/db/test-connection.js

# You should see:
# ✅ Database connection successful!
# Server time: 2026-05-10T11:58:36.000Z
```

Then we'll move on to building the data fetchers and REST API.
