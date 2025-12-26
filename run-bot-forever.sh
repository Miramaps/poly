#!/bin/bash

export DATABASE_URL="postgresql://polytrader:polytrader@localhost:5432/polytrader"
export DASH_USER="admin"
export DASH_PASS="sexmachine666"

WINDOW=900  # 15 minutes

while true; do
    NOW=$(date +%s)
    # FIXED: Use window START for the slug (not END)
    WINDOW_START=$(( (NOW / WINDOW) * WINDOW ))
    WINDOW_END=$((WINDOW_START + WINDOW))
    SECONDS_LEFT=$((WINDOW_END - NOW))
    
    # FIXED: Slug uses WINDOW_START, not WINDOW_END
    CURRENT_SLUG="btc-updown-15m-$WINDOW_START"
    
    echo ""
    echo "============================================"
    echo "[$(date -u)] NEW MARKET WINDOW"
    echo "Market: $CURRENT_SLUG"
    echo "Window: $(date -u -d @$WINDOW_START 2>/dev/null || date -r $WINDOW_START -u) to $(date -u -d @$WINDOW_END 2>/dev/null || date -r $WINDOW_END -u)"
    echo "Ends in: ${SECONDS_LEFT}s"
    echo "============================================"
    
    # Get tokens from gamma API
    MARKET_DATA=$(node ~/scrape_market.js "$CURRENT_SLUG" 2>/dev/null)
    
    if echo "$MARKET_DATA" | grep -q '"success":true'; then
        export MARKET_SLUG="$CURRENT_SLUG"
        export UP_TOKEN_ID=$(echo "$MARKET_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin).get('upToken',''))")
        export DOWN_TOKEN_ID=$(echo "$MARKET_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin).get('downToken',''))")
        
        echo "[OK] UP Token: ${UP_TOKEN_ID:0:30}..."
        echo "[OK] DOWN Token: ${DOWN_TOKEN_ID:0:30}..."
        
        # Kill any running bot
        pkill -9 -f poly-trader-cpp 2>/dev/null
        sleep 1
        
        # Start bot for this window
        cd ~/poly-cpp/build
        timeout ${SECONDS_LEFT}s ./poly-trader-cpp &
        BOT_PID=$!
        
        echo "[OK] Bot started (PID: $BOT_PID) for ${SECONDS_LEFT}s"
        
        # Wait for window to end
        sleep $((SECONDS_LEFT + 5))
        
        # Kill bot
        kill -9 $BOT_PID 2>/dev/null
        echo "[DONE] Window ended, switching to next..."
    else
        echo "[ERROR] Failed to get market data: $MARKET_DATA"
        sleep 30
    fi
done
