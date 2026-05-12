#!/bin/bash

# Master script to run all DNO power cut scrapers sequentially
# Minimum set for full UK coverage:
#   UKPN           - London, SE England, Eastern England
#   SSEN           - South England + North Scotland
#   Northern Powergrid - NE England + Yorkshire
#   ENWL           - NW England (pending API key)
#   SP Energy      - Scotland (SPD/SPM) + NW Wales/Merseyside
#   NGED           - Midlands, SW England, S Wales
#   NIE            - Northern Ireland

echo "🚀 POWERCUT AGGREGATOR - Master Scraper"
echo "========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRAPERS_DIR="$SCRIPT_DIR/src/scrapers"

# Track results
TOTAL_SCRAPERS=0
SUCCESSFUL_SCRAPERS=0
FAILED_SCRAPERS=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run a scraper
run_scraper() {
  local scraper_name=$1
  local scraper_file=$2

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Running: $scraper_name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ -f "$SCRAPERS_DIR/$scraper_file" ]; then
    TOTAL_SCRAPERS=$((TOTAL_SCRAPERS + 1))

    if node "$SCRAPERS_DIR/$scraper_file"; then
      echo ""
      echo -e "${GREEN}✅ $scraper_name completed successfully${NC}"
      SUCCESSFUL_SCRAPERS=$((SUCCESSFUL_SCRAPERS + 1))
    else
      echo ""
      echo -e "${RED}❌ $scraper_name failed${NC}"
      FAILED_SCRAPERS=$((FAILED_SCRAPERS + 1))
    fi
  else
    echo -e "${YELLOW}⚠️  Scraper not found: $scraper_file${NC}"
  fi
}

# Run all scrapers
echo "Starting scraper runs at $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Group 1: UKPN (UK Power Networks)
run_scraper "UKPN" "ukpn-fetcher.js"

# Group 2: SSEN (Scottish and Southern Electricity Networks)
run_scraper "SSEN" "ssen-fetcher.js"

# Group 3: Northern Powergrid
run_scraper "Northern Powergrid" "northern-powergrid-puppeteer.js"

# Group 4: ENWL (Electricity North West) — NW England
run_scraper "ENWL" "enwl-fetcher.js"

# Group 5: SP Energy
run_scraper "SP Energy Networks" "sp-energy-puppeteer.js"

# Group 6: NGED (National Grid Electricity Distribution)
run_scraper "NGED" "nged-fetcher.js"

# Group 7: NIE Networks (Northern Ireland)
run_scraper "NIE Networks" "nie-fetcher.js"

# Cleanup: delete resolved outages older than 24h
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Running: Cleanup (resolved > 24h)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
node "$SCRIPT_DIR/scripts/cleanup-resolved.js"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total scrapers run: $TOTAL_SCRAPERS"
echo -e "${GREEN}✅ Successful: $SUCCESSFUL_SCRAPERS${NC}"
if [ $FAILED_SCRAPERS -gt 0 ]; then
  echo -e "${RED}❌ Failed: $FAILED_SCRAPERS${NC}"
else
  echo "❌ Failed: $FAILED_SCRAPERS"
fi
echo ""
echo "Completed at $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

if [ $FAILED_SCRAPERS -eq 0 ] && [ $TOTAL_SCRAPERS -gt 0 ]; then
  echo -e "${GREEN}🎉 All scrapers completed successfully!${NC}"
  exit 0
else
  echo -e "${YELLOW}⚠️  Some scrapers failed or were not found${NC}"
  exit 1
fi
