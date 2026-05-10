# Stage 2: Database Schema & Data Normalization Strategy

**Date:** 10 May 2026  
**Project:** Power Cut Aggregator  
**Objective:** Design a unified database schema to normalize data from all 14 DNOs

---

## Overview

We have 14 DNOs with 3 different data access patterns:
- **3 DNOs with APIs/Datasets** (UKPN, SSEN, partial web access)
- **5 regions needing web scraping** (NGED/WPD)
- **Additional scraping** (Northern Powergrid, Scottish Power)

Each source provides **different field names, formats, and structures**. Our job: create ONE unified schema that normalizes all of them.

---

## Key Design Principle

**Map disparate data sources → Single logical model → Single database**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Disparate DNO Data Sources                   │
├─────────────────┬──────────────────┬──────────────────────────┤
│   UKPN API      │   SSEN Dataset   │   Web Scraping (others)  │
│  (JSON/REST)    │  (Dataset/CSV?)  │   (HTML parsing)         │
└────────┬────────┴────────┬─────────┴────────┬─────────────────┘
         │                 │                  │
         └─────────────────┴──────────────────┘
                           │
                  ┌────────▼────────┐
                  │ Normalization   │
                  │ Layer (Node.js) │
                  └────────┬────────┘
                           │
                  ┌────────▼────────────────┐
                  │ Unified Database Model  │
                  │ (PostgreSQL/SQLite)     │
                  └────────┬─────────────────┘
                           │
                  ┌────────▼────────┐
                  │  REST API       │
                  │ (/api/outages)  │
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │  Frontend Map   │
                  │  (User View)    │
                  └─────────────────┘
```

---

## Core Data Model

All outages share these **essential attributes**:

```javascript
{
  // Identification
  outage_id: string,                    // Unique UUID (generated locally)
  dno_fault_id: string,                 // Original DNO's fault ID
  dno: string,                          // Which DNO reported this ("UKPN", "SSEN", "NGED", etc.)
  
  // Classification
  outage_type: 'planned' | 'unplanned', // Planned maintenance vs emergency
  severity: 'critical' | 'major' | 'moderate' | 'minor', // Our own classification
  
  // Location & Scope
  affected_postcode_area: string,       // Main postcode affected (e.g., "SW1A")
  affected_postcodes: string[],         // Array of all affected postcodes
  customers_affected: number,           // Total customers impacted
  location_description: string,         // "North London", "Central Manchester", etc.
  lat: number,                          // Aggregated geopoint (postcode center)
  lon: number,
  
  // Timing
  start_time: ISO8601,                  // When the outage began
  estimated_restoration_time: ISO8601,  // DNO's estimate (may change)
  actual_restoration_time: ISO8601|null,// When power was restored (null if ongoing)
  expected_duration_minutes: number,    // Calculated duration
  
  // Details
  cause: string,                        // "Fault on overhead line", "Planned maintenance", etc.
  fault_description: string,            // Extended narrative
  reference_number: string,             // DNO's reference/ticket number
  
  // Data source tracking
  source_url: string,                   // Where this data came from
  raw_data: object,                     // Original DNO data (for debugging)
  
  // System fields
  created_at: ISO8601,                  // When we first saw this outage
  updated_at: ISO8601,                  // Last time we updated this record
  last_verified: ISO8601,               // When we last checked with DNO
  status: 'active' | 'resolved' | 'closed'
}
```

---

## Data Mapping Strategy

### Source 1: UK Power Networks (UKPN) — API

**UKPN provides:**
```
- fault_id → outage_id
- fault_start_time → start_time
- estimated_restoration_time → estimated_restoration_time
- customers_affected → customers_affected
- postcode (aggregated) → affected_postcode_area
- geopoint (lat/long) → lat/lon
- planned_or_unplanned → outage_type
- description → fault_description
```

**Example mapping:**
```javascript
// Raw UKPN API response
{
  "fault_id": "DN-LONDON-201759",
  "fault_start_time": "2026-05-10T09:30:00Z",
  "estimated_restoration_time": "2026-05-10T12:00:00Z",
  "customers_affected": 1250,
  "location_postcode": "EC1A",
  "geo_point": { "lat": 51.519, "lon": -0.102 },
  "planned": false,
  "description": "Fault on underground cable"
}

// Normalized model
{
  outage_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  dno_fault_id: "DN-LONDON-201759",
  dno: "UKPN",
  outage_type: "unplanned",
  affected_postcode_area: "EC1A",
  affected_postcodes: ["EC1A1AA", "EC1A1AB", ...], // Derived from postcode area
  customers_affected: 1250,
  location_description: "London - City of London",
  lat: 51.519,
  lon: -0.102,
  start_time: "2026-05-10T09:30:00Z",
  estimated_restoration_time: "2026-05-10T12:00:00Z",
  cause: "Fault on underground cable",
  severity: "major", // Calculated from customers_affected
  created_at: "2026-05-10T09:35:00Z",
  updated_at: "2026-05-10T09:35:00Z"
}
```

---

### Source 2: SSEN — Real-time Dataset

**SSEN likely provides:**
- Outage ID
- Start/end times
- Affected postcodes
- Estimated restoration
- Fault type (planned/unplanned)
- Cause
- Customer count

**Mapping:** Similar to UKPN, normalize field names to our schema.

---

### Source 3: Web Scraped Sources (Northern Powergrid, NGED, Scottish Power)

**Challenges:**
- No structured API → must parse HTML/JavaScript
- Field names vary between websites
- Location info may only be textual ("Manchester city center")
- Some might not provide customer counts
- Timing data may be less precise

**Strategy:**
1. Scrape their power cut maps/pages
2. Extract available data
3. Use **postcode lookup service** to convert locations to postcodes
4. Fill missing fields with defaults/estimates

**Example for Northern Powergrid (scraped):**
```html
<!-- Raw HTML from their map -->
<div class="outage">
  <h3>Manchester Area - Fault</h3>
  <p>Estimated restoration: 2pm</p>
  <p>Customers affected: ~2000</p>
  <p>Cause: Storm damage</p>
</div>

// Normalized
{
  outage_id: "uuid",
  dno_fault_id: "UNKNOWN", // May not be available from website
  dno: "NORTHERN_POWERGRID",
  outage_type: "unplanned",
  affected_postcode_area: "M1", // Derived from "Manchester Area"
  location_description: "Manchester city center",
  customers_affected: 2000,
  estimated_restoration_time: "2026-05-10T14:00:00Z",
  cause: "Storm damage"
}
```

---

## Database Schema (PostgreSQL)

```sql
CREATE TABLE outages (
  -- Primary key
  outage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- DNO & Reference
  dno_fault_id VARCHAR(100),  -- DNO's internal ID
  dno VARCHAR(50) NOT NULL,   -- "UKPN", "SSEN", "NGED", etc.
  
  -- Classification
  outage_type VARCHAR(20) NOT NULL CHECK (outage_type IN ('planned', 'unplanned')),
  severity VARCHAR(20) CHECK (severity IN ('critical', 'major', 'moderate', 'minor')),
  
  -- Location
  affected_postcode_area VARCHAR(10),
  affected_postcodes TEXT[], -- Array of postcodes
  customers_affected INTEGER,
  location_description VARCHAR(500),
  lat DECIMAL(9,6),
  lon DECIMAL(9,6),
  
  -- Timing
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  estimated_restoration_time TIMESTAMP WITH TIME ZONE,
  actual_restoration_time TIMESTAMP WITH TIME ZONE,
  expected_duration_minutes INTEGER,
  
  -- Details
  cause VARCHAR(255),
  fault_description TEXT,
  reference_number VARCHAR(100),
  source_url VARCHAR(500),
  
  -- Status tracking
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'closed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_verified TIMESTAMP WITH TIME ZONE,
  
  -- Raw data for debugging
  raw_data JSONB,
  
  -- Indexes
  INDEX idx_dno (dno),
  INDEX idx_start_time (start_time),
  INDEX idx_status (status),
  INDEX idx_postcode_area (affected_postcode_area),
  UNIQUE(dno, dno_fault_id)  -- Prevent duplicates from same DNO
);

-- Track historical data
CREATE TABLE outage_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outage_id UUID NOT NULL REFERENCES outages(outage_id),
  estimated_restoration_time TIMESTAMP WITH TIME ZONE,
  customers_affected INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## API Endpoints

Once data is in the database, expose via REST API:

```
GET /api/outages
  - Returns all active outages
  - Query params: dno, outage_type, status, sort_by

GET /api/outages/:outage_id
  - Returns single outage with full details

GET /api/outages/postcode/:postcode
  - Returns outages affecting a specific postcode
  - E.g., /api/outages/postcode/SW1A1AA

GET /api/outages/area/:area
  - Returns outages by DNO area
  - E.g., /api/outages/area/london

GET /api/stats
  - Returns aggregates: total outages, customers affected, by DNO, etc.

GET /api/outages/planned
  - Returns only planned outages (future maintenance)

GET /api/outages/history/:outage_id
  - Returns timeline of changes to an outage
```

---

## Data Update Strategy

**Cron Job Pseudocode:**

```javascript
// Runs every 15 minutes
async function updateAllOutages() {
  // For each DNO:
  //   1. Fetch latest data (API call or web scrape)
  //   2. Normalize to our schema
  //   3. Check if outage_id already exists in DB
  //   4. If new: INSERT
  //   5. If exists: UPDATE (if changed)
  //   6. If restored: Mark as resolved
  //   7. Log what was done
}
```

---

## Key Considerations

### 1. **Deduplication**
- UKPN's `fault_id` + `dno` should be unique
- Prevent same outage being stored multiple times

### 2. **Location Normalization**
- Convert text descriptions → postcode areas
- Use UK postcode lookup service (postcode.io, etc.)
- Store both `affected_postcode_area` (for aggregation) and `affected_postcodes` (detail)

### 3. **Missing Data**
- Not all DNOs provide customer counts
- Severity can be estimated from customers affected or location importance
- Use sensible defaults

### 4. **Historical Tracking**
- Keep `outage_history` table for trend analysis (when we add that feature)
- Allows us to see: "estimated time changed from 2pm to 4pm"

### 5. **Data Freshness**
- Track `last_verified` timestamp
- Frontend can show: "Last updated 5 minutes ago"

---

## Next Steps

1. **Pick a database:** PostgreSQL (recommended) or SQLite (simpler for MVP)
2. **Set up database:** Create tables and indexes
3. **Build data connector layer:** Functions to normalize each DNO's data
4. **Implement cron job:** Script that runs every 15 mins to fetch & update
5. **Test with one DNO:** Get UKPN API working first
6. **Expand to others:** Add scrapers incrementally

---

## Estimated Schema Complexity

- **Simple model:** ✅ Works
- **Handles all 14 DNOs:** ✅ Flexible enough
- **Supports future features:** ✅ (history, trends, alerts)
- **Performance:** ✅ With proper indexes

This schema is **pragmatic** — it doesn't try to capture every possible field from every DNO, just the **core fields everyone needs**.

