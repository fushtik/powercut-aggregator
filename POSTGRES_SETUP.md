# PostgreSQL Setup & Configuration

**Project:** Power Cut Aggregator  
**Database:** PostgreSQL 14+  
**Purpose:** Store and query outage data from all 14 UK DNOs

---

## Overview

This guide covers:
1. Creating the PostgreSQL database and tables
2. Setting up indexes for performance
3. Connection configuration for Node.js
4. Initial data structure

---

## Database & User Setup

### Step 1: Create Database User

```sql
-- Connect to PostgreSQL as superuser (psql -U postgres)

CREATE USER powercut_user WITH PASSWORD 'your_secure_password_here';
ALTER ROLE powercut_user SET client_encoding TO 'utf8';
ALTER ROLE powercut_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE powercut_user SET default_transaction_deferrable TO on;
ALTER ROLE powercut_user SET default_timezone TO 'UTC';
```

### Step 2: Create Database

```sql
CREATE DATABASE powercut_aggregator 
  OWNER powercut_user 
  ENCODING 'UTF8' 
  TEMPLATE template0;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE powercut_aggregator TO powercut_user;
```

### Step 3: Enable Extensions

```sql
-- Connect to powercut_aggregator database
\c powercut_aggregator

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable JSONB for flexible raw_data storage
-- (Built-in, no extension needed)
```

---

## Create Core Tables

### Main Outages Table

```sql
-- Drop if exists (careful in production!)
DROP TABLE IF EXISTS outage_history CASCADE;
DROP TABLE IF EXISTS outages CASCADE;

-- Main outages table
CREATE TABLE outages (
  -- Primary Key
  outage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- DNO & Reference
  dno_fault_id VARCHAR(100) NOT NULL,          -- Original fault ID from DNO
  dno VARCHAR(50) NOT NULL,                    -- "UKPN", "SSEN", "NGED", etc.
  
  -- Classification
  outage_type VARCHAR(20) NOT NULL DEFAULT 'unplanned',
  severity VARCHAR(20),                        -- "critical", "major", "moderate", "minor"
  
  -- Location & Scope
  affected_postcode_area VARCHAR(10),          -- e.g., "SW1A", "M1", "EC1A"
  affected_postcodes TEXT[],                   -- Array: ["SW1A1AA", "SW1A1AB", ...]
  customers_affected INTEGER,
  location_description VARCHAR(500),           -- Human-readable: "Central London", "Manchester"
  lat DECIMAL(9,6),                            -- Latitude (aggregated to postcode center)
  lon DECIMAL(9,6),                            -- Longitude
  
  -- Timing
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  estimated_restoration_time TIMESTAMP WITH TIME ZONE,
  actual_restoration_time TIMESTAMP WITH TIME ZONE,
  expected_duration_minutes INTEGER,
  
  -- Details
  cause VARCHAR(255),                          -- "Fault on overhead line", "Storm damage", etc.
  fault_description TEXT,                      -- Extended narrative
  reference_number VARCHAR(100),               -- DNO's reference/ticket number
  source_url VARCHAR(500),                     -- URL where data was sourced
  
  -- Status & Tracking
  status VARCHAR(20) DEFAULT 'active',         -- "active", "resolved", "closed"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_verified TIMESTAMP WITH TIME ZONE,
  
  -- Raw data for debugging/audit trail
  raw_data JSONB,                              -- Store original DNO response
  
  -- Constraints
  CONSTRAINT outage_type_check CHECK (outage_type IN ('planned', 'unplanned')),
  CONSTRAINT status_check CHECK (status IN ('active', 'resolved', 'closed')),
  CONSTRAINT severity_check CHECK (severity IS NULL OR severity IN ('critical', 'major', 'moderate', 'minor')),
  CONSTRAINT unique_dno_fault UNIQUE(dno, dno_fault_id)  -- Prevent duplicates from same DNO
);

-- Create indexes for performance
CREATE INDEX idx_outages_dno ON outages(dno);
CREATE INDEX idx_outages_status ON outages(status);
CREATE INDEX idx_outages_start_time ON outages(start_time DESC);
CREATE INDEX idx_outages_postcode_area ON outages(affected_postcode_area);
CREATE INDEX idx_outages_created_at ON outages(created_at DESC);
CREATE INDEX idx_outages_geopoint ON outages(lat, lon);  -- For geographic queries
CREATE INDEX idx_outages_updated_at ON outages(updated_at DESC);

-- Partial indexes for common queries
CREATE INDEX idx_outages_active ON outages(status) WHERE status = 'active';
CREATE INDEX idx_outages_recent ON outages(start_time DESC) WHERE status = 'active';

-- Comment on table
COMMENT ON TABLE outages IS 'Unified outage data from all 14 UK DNOs';
COMMENT ON COLUMN outages.outage_id IS 'System-generated UUID, unique identifier';
COMMENT ON COLUMN outages.dno_fault_id IS 'Original fault ID from the DNO system';
COMMENT ON COLUMN outages.raw_data IS 'Original JSON response from DNO for debugging and audit trail';
```

---

### Outage History Table

```sql
CREATE TABLE outage_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outage_id UUID NOT NULL REFERENCES outages(outage_id) ON DELETE CASCADE,
  
  -- Changed values (what was updated)
  estimated_restoration_time TIMESTAMP WITH TIME ZONE,
  customers_affected INTEGER,
  location_description VARCHAR(500),
  cause VARCHAR(255),
  status VARCHAR(20),
  
  -- Metadata
  change_description VARCHAR(255),             -- What changed: "ETA updated", "Status changed to resolved"
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Track why it changed
  change_source VARCHAR(50)                    -- "api_update", "web_scrape", "manual", "auto_resolution"
);

-- Indexes for history queries
CREATE INDEX idx_history_outage_id ON outage_history(outage_id);
CREATE INDEX idx_history_recorded_at ON outage_history(recorded_at DESC);
CREATE INDEX idx_history_change_source ON outage_history(change_source);

COMMENT ON TABLE outage_history IS 'Track all changes to outages for audit trail and trend analysis';
```

---

### Postcode Lookup Cache Table

```sql
-- Cache postcode to DNO region mappings (for faster lookups)
CREATE TABLE postcode_cache (
  postcode VARCHAR(10) PRIMARY KEY,
  postcode_area VARCHAR(4),                    -- e.g., "SW1", "M1", "EC1"
  dno VARCHAR(50),                             -- Which DNO covers this postcode
  region_name VARCHAR(100),                    -- Human-readable region: "Central London"
  lat DECIMAL(9,6),
  lon DECIMAL(9,6),
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_postcode_area ON postcode_cache(postcode_area);
CREATE INDEX idx_postcode_dno ON postcode_cache(dno);

COMMENT ON TABLE postcode_cache IS 'Cache of postcode to DNO mappings to speed up location-based queries';
```

---

### System Logs Table

```sql
-- Track scraper runs, API calls, errors
CREATE TABLE data_fetch_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dno VARCHAR(50) NOT NULL,
  fetch_method VARCHAR(50),                    -- "api", "web_scrape", "dataset_download"
  
  status VARCHAR(20),                          -- "success", "partial", "failed"
  outages_found INTEGER,
  outages_updated INTEGER,
  outages_created INTEGER,
  
  error_message TEXT,
  http_status_code INTEGER,
  
  execution_time_ms INTEGER,                   -- How long the fetch took
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Raw response for debugging (first 10KB)
  response_sample TEXT
);

CREATE INDEX idx_fetch_log_dno ON data_fetch_log(dno);
CREATE INDEX idx_fetch_log_fetched_at ON data_fetch_log(fetched_at DESC);
CREATE INDEX idx_fetch_log_status ON data_fetch_log(status);

COMMENT ON TABLE data_fetch_log IS 'Log of all data fetch operations for monitoring and debugging';
```

---

## Environment Variables

Create a `.env` file in your project root:

```bash
# Database Connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=powercut_aggregator
DB_USER=powercut_user
DB_PASSWORD=your_secure_password_here

# Node Environment
NODE_ENV=development

# Server
SERVER_PORT=3000

# Logging
LOG_LEVEL=info

# API Settings
API_REQUEST_TIMEOUT=30000  # 30 seconds
API_RATE_LIMIT=100         # requests per minute
```

**Important:** Add `.env` to `.gitignore` (never commit secrets):

```bash
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Add .env to gitignore"
```

---

## Node.js Connection Pool

### Installation

```bash
npm install pg dotenv
```

### Connection Module

Create `src/db/connection.js`:

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'powercut_aggregator',
  user: process.env.DB_USER || 'powercut_user',
  password: process.env.DB_PASSWORD,
  max: 20,                              // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;
```

### Test Connection

Create `src/db/test-connection.js`:

```javascript
const pool = require('./connection');

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful!');
    console.log('Server time:', result.rows[0].now);
    process.exit(0);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
```

Run: `node src/db/test-connection.js`

---

## Initialize Database Schema

Create `src/db/init-schema.js`:

```javascript
const fs = require('fs');
const path = require('path');
const pool = require('./connection');

async function initializeSchema() {
  try {
    console.log('🔄 Initializing database schema...');
    
    // Read the SQL file with all table definitions
    const sqlFile = path.join(__dirname, '../../POSTGRES_SETUP.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Execute all SQL statements
    await pool.query(sql);
    
    console.log('✅ Schema initialized successfully!');
    
    // Verify tables exist
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('\n📋 Created tables:');
    result.rows.forEach(row => console.log(`   - ${row.table_name}`));
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Schema initialization failed:', err.message);
    process.exit(1);
  }
}

initializeSchema();
```

---

## Sample Query Functions

Create `src/db/queries.js`:

```javascript
const pool = require('./connection');

// Get all active outages
async function getActiveOutages() {
  return pool.query(`
    SELECT * FROM outages 
    WHERE status = 'active' 
    ORDER BY start_time DESC
  `);
}

// Get outages by postcode
async function getOutagesByPostcode(postcode) {
  return pool.query(`
    SELECT * FROM outages 
    WHERE affected_postcode_area = $1 
      AND status = 'active'
    ORDER BY start_time DESC
  `, [postcode.substring(0, 4)]); // Extract area code
}

// Get outages by DNO
async function getOutagesByDNO(dno) {
  return pool.query(`
    SELECT * FROM outages 
    WHERE dno = $1 
      AND status = 'active'
    ORDER BY start_time DESC
  `, [dno]);
}

// Insert new outage
async function createOutage(outageData) {
  const {
    dno_fault_id, dno, outage_type, affected_postcode_area,
    customers_affected, location_description, start_time,
    estimated_restoration_time, cause, fault_description,
    lat, lon, raw_data
  } = outageData;

  return pool.query(`
    INSERT INTO outages (
      dno_fault_id, dno, outage_type, affected_postcode_area,
      customers_affected, location_description, start_time,
      estimated_restoration_time, cause, fault_description,
      lat, lon, raw_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (dno, dno_fault_id) DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP,
      estimated_restoration_time = EXCLUDED.estimated_restoration_time,
      customers_affected = EXCLUDED.customers_affected,
      raw_data = EXCLUDED.raw_data
    RETURNING outage_id
  `, [dno_fault_id, dno, outage_type, affected_postcode_area,
      customers_affected, location_description, start_time,
      estimated_restoration_time, cause, fault_description,
      lat, lon, JSON.stringify(raw_data)]);
}

// Mark outage as resolved
async function resolveOutage(outageId) {
  return pool.query(`
    UPDATE outages 
    SET status = 'resolved', 
        actual_restoration_time = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE outage_id = $1
  `, [outageId]);
}

// Get statistics
async function getOutageStats() {
  return pool.query(`
    SELECT 
      COUNT(*) as total_active,
      SUM(customers_affected) as total_customers_affected,
      COUNT(DISTINCT dno) as dnos_affected,
      COUNT(CASE WHEN outage_type = 'planned' THEN 1 END) as planned_outages
    FROM outages
    WHERE status = 'active'
  `);
}

module.exports = {
  getActiveOutages,
  getOutagesByPostcode,
  getOutagesByDNO,
  createOutage,
  resolveOutage,
  getOutageStats
};
```

---

## Deployment Considerations

### Hostinger PostgreSQL

If using Hostinger's managed PostgreSQL:

1. Create database through Hostinger panel
2. Get connection credentials (host, port, user, password, database)
3. Add to `.env` file
4. Test connection from your local machine
5. Update in Hostinger's Node.js environment variables

### Backups

PostgreSQL backups:

```bash
# Manual backup
pg_dump -U powercut_user -h localhost powercut_aggregator > backup.sql

# Restore from backup
psql -U powercut_user -h localhost powercut_aggregator < backup.sql

# Automated daily backup (add to crontab)
0 2 * * * pg_dump -U powercut_user powercut_aggregator > /backups/powercut_$(date +\%Y\%m\%d).sql
```

---

## Performance Optimization Tips

1. **Indexes:** Already created for common queries
2. **Partitioning:** Later, partition by month if table gets huge
3. **Vacuuming:** PostgreSQL auto-vacuums, but can schedule manually
4. **Query analysis:** Use `EXPLAIN ANALYZE` to optimize slow queries

---

## Security Notes

- Never commit `.env` file
- Use strong passwords for DB user
- Restrict DB access by IP (if on Hostinger)
- Encrypt connections in production (SSL)
- Regular backups to secure location

---

## Next: Data Fetch Layer

Once DB is set up, we'll build:
1. UKPN API fetcher
2. Web scrapers for other DNOs
3. Cron job to run fetchers periodically
4. Normalization layer to insert data into DB
5. REST API endpoints to query the data

