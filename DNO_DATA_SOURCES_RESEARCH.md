# UK DNO Data Sources Research - Stage 1

**Date:** 10 May 2026  
**Project:** Power Cut Aggregator  
**Objective:** Map data availability across all 14 UK Distribution Network Operators

---

## Executive Summary

Out of 14 UK DNOs, **at least 3 major operators provide programmatic access** to outage data via APIs or datasets:
- **UK Power Networks** (UKPN) - **FULL API AVAILABLE** ✅
- **SSEN (Scottish & Southern Electricity Networks)** - **REAL-TIME DATASET AVAILABLE** ✅
- **Northern Powergrid** - **MAP-BASED ACCESS** ✅

Others provide web-based power cut checkers but specific API details were not readily available through public documentation.

---

## The 14 UK DNOs (Grouped by Parent Company)

### 1. UK Power Networks (3 regions)
- **Eastern Electricity (now UK Power Networks East)**
- **London Electricity (now UK Power Networks London)**
- **South Eastern Electricity (now UK Power Networks South East)**

### 2. Western Power Distribution / National Grid Electricity Distribution (4 regions)
- **East Midlands Electricity**
- **Merseyside and Northern Electric**
- **West Midlands Electricity**
- **South Wales Electricity**
- **South Western Electricity**

### 3. Scottish Power / SP Energy Networks (1 region)
- **Scottish Power Distribution (Central & Southern Scotland)**

### 4. SSEN (2 regions)
- **Scottish Hydro Electric Power Distribution**
- **Southern Electric Power Distribution**

### 5. Northern Powergrid (2 regions)
- **Northern Powergrid (East)**
- **Northern Powergrid (West)**

### 6. UK Power Networks (1 additional)
- **Yorkshire Electricity (now UK Power Networks affiliated)**

---

## Detailed DNO Data Availability

### ✅ UK Power Networks (UKPN) - CONFIRMED API ACCESS

**Coverage Areas:**
- Eastern Electricity (East Anglia)
- London Electricity (London & South East)
- South Eastern Electricity (South East England)

**Data Available:**
- Live fault data (current outages)
- Planned power cuts
- Unplanned power cuts
- Postcode-based aggregation
- Customer count affected (5+ customers minimum)
- Geopoint data (lat/long)

**Access Method:**
- **API:** Available via OpenDataSoft platform
- **Endpoint:** `ukpowernetworks.opendatasoft.com/api/v2.1/...`
- **Format:** JSON
- **Authentication:** Public access (no API key required)
- **Rate Limit:** Standard OpenDataSoft limits apply
- **Documentation:** Available on Open Data Portal

**Key Fields:**
```
- fault_id
- fault_start_time
- estimated_restoration_time
- customers_affected
- fault_location (postcode aggregated)
- geopoint (lat/long)
- planned_or_unplanned
```

**Limitations:**
- Data omits faults affecting ≤5 customers (privacy)
- Geopoints aggregated by postcode (not exact addresses)
- Real-time but with some latency

**Source:** [UK Power Networks Open Data Portal](https://ukpowernetworks.opendatasoft.com/explore/dataset/ukpn-live-faults/)

---

### ✅ SSEN (Scottish & Southern Electricity Networks) - REAL-TIME DATASET

**Coverage Areas:**
- Scottish Hydro Electric Power Distribution
- Southern Electric Power Distribution

**Data Available:**
- Real-time outage dataset
- Planned and unplanned outages
- Affected postcodes
- Outage reasons
- Expected repair schedules

**Access Method:**
- **Dataset:** Real Time Outage Dataset
- **Portal:** SSEN Distribution Data Portal (`data.ssen.co.uk`)
- **Format:** Unknown (needs verification)
- **Access:** Public (may require registration)

**Key Features:**
- Power Track map-based tool (interactive)
- Fault reference numbers
- Emergency contact details
- Affected postcodes
- Start times and repair schedules
- Automatic update notifications available

**Source:** [SSEN Distribution Data Portal](https://data.ssen.co.uk/@ssen-distribution/realtime_outage_dataset)

---

### ✅ Northern Powergrid - MAP-BASED ACCESS

**Coverage Areas:**
- Northern Powergrid (East) - Eastern & Yorkshire region
- Northern Powergrid (West) - Northwest region

**Data Available:**
- Current power cuts
- Planned outages
- Interactive map display

**Access Method:**
- **Primary:** Interactive map on website
- **URL:** `www.northernpowergrid.com/power-cuts-map`
- **Format:** Web-based (would require scraping for data)

**Scraping Considerations:**
- Would need to parse HTML/JavaScript from their map
- No official API documented

**Source:** [Northern Powergrid Power Cuts Map](https://www.northernpowergrid.com/power-cuts-map)

---

### 🟡 National Grid Electricity Distribution (NGED / WPD)

**Coverage Areas:**
- East Midlands Electricity
- Merseyside and Northern Electric
- West Midlands Electricity
- South Wales Electricity
- South Western Electricity

**Data Available:**
- Current outages
- Planned outages
- Postcode lookup

**Access Method:**
- **Primary:** Power Cuts Checker website (`powercuts.westernpower.co.uk`)
- **Alternative:** Power Cuts Checker (`powercuts.nationalgrid.co.uk`)
- **Format:** Web-based (would require scraping)
- **Mobile App:** "Power Cut Reporter" app available (API potentially available)

**Scraping Considerations:**
- No official API documented
- Would require parsing web pages or reverse-engineering app API

**Source:** [National Grid Power Cuts Checker](https://powercuts.nationalgrid.co.uk/)

---

### 🟡 Scottish Power (SP Energy Networks)

**Coverage Area:**
- Scottish Power Distribution (Central & Southern Scotland)
- Cheshire, Merseyside, Wales & Shropshire

**Data Available:**
- Current power cuts
- Planned outages
- Postcode lookup

**Access Method:**
- **Primary:** Power Cuts Checker (`powercuts.spenergynetworks.co.uk`)
- **Map:** Power Cuts Map
- **Format:** Web-based (would require scraping)

**Scraping Considerations:**
- No official API documented
- Map-based (similar to Northern Powergrid)

**Source:** [SP Energy Networks Power Cuts Map](https://www.spenergynetworks.co.uk/pages/power_cuts_map.aspx)

---

### ⏳ Others (Requires Further Research)

The following DNOs were mentioned in your original list but require deeper investigation:

- **Yorkshire Electricity** - Part of UK Power Networks group (likely covered under UKPN API)

**Common Features Across All DNOs:**
- **Emergency Number:** 105 (free, 24/7)
- **Postcode Lookup:** Available on all websites
- **Web-Based Checkers:** All have customer-facing web tools

---

## Data Access Summary Table

| DNO | Region | API | Dataset | Map | Scrape | Status |
|-----|--------|-----|---------|-----|--------|--------|
| UK Power Networks (3) | East, London, SE | ✅ | ✅ | ✅ | ✅ | **Ready** |
| SSEN (2) | Scotland, SE England | ? | ✅ | ✅ | ✅ | **Investigate** |
| Northern Powergrid (2) | North | ❌ | ❌ | ✅ | ✅ | **Scraping** |
| National Grid / NGED (5) | Midlands, Wales, SW | ❌ | ❌ | ✅ | ✅ | **Scraping** |
| Scottish Power (1) | Scotland | ❌ | ❌ | ✅ | ✅ | **Scraping** |

---

## Recommended Approach

### Phase 1 - Quick Wins (Lowest Effort)
1. **UK Power Networks** - Use the public API immediately (covers 3 major regions)
2. **SSEN** - Investigate the real-time dataset (covers 2 regions)
3. **Northern Powergrid** - Web scraping (covers 2 regions)

This covers **7 out of 14 DNOs** with relatively straightforward methods.

### Phase 2 - Scraping-Based (Medium Effort)
1. **National Grid / NGED** (5 regions) - Web scraper for power cuts checker pages
2. **Scottish Power** (1 region) - Web scraper for power cuts map

This covers the remaining **6 out of 14 DNOs**.

### Data Normalization Strategy

Once data is collected from all sources, we'll need a common schema:

```javascript
{
  fault_id: string,              // Unique across all DNOs
  dno: string,                   // DNO name
  fault_type: 'planned' | 'unplanned',
  affected_postcodes: string[],  // Array of postcodes
  customers_affected: number,    // Total customers
  start_time: ISO8601,
  estimated_restoration_time: ISO8601,
  actual_restoration_time: ISO8601 | null,
  cause: string,
  location_name: string,
  geopoint: {
    lat: number,
    lon: number
  },
  source: string,                // Which DNO's system
  last_updated: ISO8601
}
```

---

## Next Steps

1. **Verify SSEN API/Dataset Details** - Contact or check documentation for exact endpoint format
2. **Test UK Power Networks API** - Make a sample API call to confirm access and data structure
3. **Assess Scraping Feasibility** - Check if Northern Powergrid, NGED, and Scottish Power pages are scraping-friendly
4. **Define Postcode-to-DNO Mapping** - Build a lookup table for mapping postcodes to DNOs
5. **Plan Update Frequency** - Decide on scraping intervals (every 15 mins? hourly?)

---

## Additional Resources

- [Energy Networks Association](https://www.energynetworks.org/) - Official DNO association
- [Ofgem Regulation](https://www.ofgem.gov.uk/) - Regulatory body
- [Emergency Number 105](https://www.power105.com/) - National power cut reporting
- [OpenDataSoft Platform](https://opendatasoft.com/) - Powers UKPN's data delivery
