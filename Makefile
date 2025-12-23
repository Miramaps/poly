.PHONY: setup dev build start stop logs test clean db-push db-studio

# ─── Development ────────────────────────────────────────────────────

setup:
	./scripts/setup.sh

dev:
	./scripts/start-local.sh

dev-bot:
	npm run dev -w apps/bot

dev-dashboard:
	npm run dev -w apps/dashboard

# ─── Build ──────────────────────────────────────────────────────────

build:
	npm run build

build-shared:
	npm run build -w packages/shared

build-bot:
	npm run build -w apps/bot

build-dashboard:
	npm run build -w apps/dashboard

# ─── Production ─────────────────────────────────────────────────────

start:
	pm2 start ecosystem.config.cjs

stop:
	pm2 stop all

restart:
	pm2 restart all

logs:
	pm2 logs

# ─── Database ───────────────────────────────────────────────────────

db-up:
	docker-compose up -d postgres

db-down:
	docker-compose down

db-push:
	npx prisma db push

db-studio:
	npx prisma studio

db-generate:
	npx prisma generate

# ─── Testing ────────────────────────────────────────────────────────

test:
	npm test

test-shared:
	npm test -w packages/shared

test-bot:
	npm test -w apps/bot

# ─── Deployment ─────────────────────────────────────────────────────

deploy:
	./scripts/deploy-ec2.sh

# ─── Cleanup ────────────────────────────────────────────────────────

clean:
	rm -rf node_modules
	rm -rf apps/*/node_modules
	rm -rf packages/*/node_modules
	rm -rf apps/*/dist
	rm -rf apps/dashboard/.next
	rm -rf packages/*/dist

# ─── CLI ────────────────────────────────────────────────────────────

cli:
	npm run cli -w apps/bot

