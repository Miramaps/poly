#!/bin/bash
set -e

echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║               POLY TRADER LOCAL DEVELOPMENT                        ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"

# Start Postgres
echo "[INFO] Starting Postgres..."
docker-compose up -d postgres

# Wait for Postgres
echo "[INFO] Waiting for Postgres..."
sleep 3

# Generate Prisma client
echo "[INFO] Generating Prisma client..."
npx prisma generate

# Push schema
echo "[INFO] Pushing database schema..."
npx prisma db push

echo ""
echo "[INFO] Starting applications..."
echo ""
echo "  Bot API will be at:    http://localhost:3001"
echo "  Dashboard will be at:  http://localhost:3000"
echo ""
echo "  Press Ctrl+C to stop all services."
echo ""

# Run both in parallel
npm run dev:bot &
BOT_PID=$!

npm run dev:dashboard &
DASH_PID=$!

# Wait for both and handle interrupt
trap "kill $BOT_PID $DASH_PID 2>/dev/null" EXIT
wait


