-- Power Cut Aggregator Database Schema
-- PostgreSQL schema for storing and querying outage data from all 14 UK DNOs

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main outages table
CREATE TABLE IF NOT EXISTS outages (
  -- Primary Key
  outage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- DNO & Reference
  dno_fault_id VARCHAR(100) NOT NULL,
  dno VARCHAR(50) NOT NULL,

  -- Classification
  outage_type VARCHAR(20) NOT NULL DEFAULT 'unplanned',
  severity VARCHAR(20),

  -- Location & Scope
  affected_postcode_area VARCHAR(10),
  affected_postcodes TEXT[],
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

  -- Status & Tracking
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_verified TIMESTAMP WITH TIME ZONE,

  -- Raw data for debugging
  raw_data JSONB,

  -- Constraints
  CONSTRAINT outage_type_check CHECK (outage_type IN ('planned', 'unplanned')),
  CONSTRAINT status_check CHECK (status IN ('active', 'resolved', 'closed')),
  CONSTRAINT severity_check CHECK (severity IS NULL OR severity IN ('critical', 'major', 'moderate', 'minor')),
  CONSTRAINT unique_dno_fault UNIQUE(dno, dno_fault_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_outages_dno ON outages(dno);
CREATE INDEX IF NOT EXISTS idx_outages_status ON outages(status);
CREATE INDEX IF NOT EXISTS idx_outages_start_time ON outages(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_outages_postcode_area ON outages(affected_postcode_area);
CREATE INDEX IF NOT EXISTS idx_outages_created_at ON outages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outages_geopoint ON outages(lat, lon);
CREATE INDEX IF NOT EXISTS idx_outages_updated_at ON outages(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outages_active ON outages(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_outages_recent ON outages(start_time DESC) WHERE status = 'active';

-- Outage history table
CREATE TABLE IF NOT EXISTS outage_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outage_id UUID NOT NULL REFERENCES outages(outage_id) ON DELETE CASCADE,

  -- Changed values
  estimated_restoration_time TIMESTAMP WITH TIME ZONE,
  customers_affected INTEGER,
  location_description VARCHAR(500),
  cause VARCHAR(255),
  status VARCHAR(20),

  -- Metadata
  change_description VARCHAR(255),
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  change_source VARCHAR(50)
);

-- Indexes for history
CREATE INDEX IF NOT EXISTS idx_history_outage_id ON outage_history(outage_id);
CREATE INDEX IF NOT EXISTS idx_history_recorded_at ON outage_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_change_source ON outage_history(change_source);

-- Postcode lookup cache
CREATE TABLE IF NOT EXISTS postcode_cache (
  postcode VARCHAR(10) PRIMARY KEY,
  postcode_area VARCHAR(4),
  dno VARCHAR(50),
  region_name VARCHAR(100),
  lat DECIMAL(9,6),
  lon DECIMAL(9,6),
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_postcode_area ON postcode_cache(postcode_area);
CREATE INDEX IF NOT EXISTS idx_postcode_dno ON postcode_cache(dno);

-- Data fetch log
CREATE TABLE IF NOT EXISTS data_fetch_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dno VARCHAR(50) NOT NULL,
  fetch_method VARCHAR(50),

  status VARCHAR(20),
  outages_found INTEGER,
  outages_updated INTEGER,
  outages_created INTEGER,

  error_message TEXT,
  http_status_code INTEGER,

  execution_time_ms INTEGER,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  response_sample TEXT
);

CREATE INDEX IF NOT EXISTS idx_fetch_log_dno ON data_fetch_log(dno);
CREATE INDEX IF NOT EXISTS idx_fetch_log_fetched_at ON data_fetch_log(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_log_status ON data_fetch_log(status);

-- Add comments
COMMENT ON TABLE outages IS 'Unified outage data from all 14 UK DNOs';
COMMENT ON TABLE outage_history IS 'Track all changes to outages for audit trail and trend analysis';
COMMENT ON TABLE postcode_cache IS 'Cache of postcode to DNO mappings to speed up location-based queries';
COMMENT ON TABLE data_fetch_log IS 'Log of all data fetch operations for monitoring and debugging';
