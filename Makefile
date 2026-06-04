# ─── Config ────────────────────────────────────────────────────────────────────

DB_URL      ?= postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable
TEST_DB_URL ?= postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable

.DEFAULT_GOAL := help

.PHONY: help \
        server frontend \
        build build-server build-frontend \
        test test-v test-run \
        fmt vet lint-fe check \
        db-reset db-psql db-dump \
        test-db-create test-db-reset \
        up up-all down logs \
        tidy

# ─── Help ──────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Dev ───────────────────────────────────────────────────────────────────────

server: ## Run Go server against local dev DB
	cd server && DATABASE_URL="$(DB_URL)" go run .

frontend: ## Run Vite dev server (http://localhost:5173)
	cd frontend && npm run dev

# ─── Build ─────────────────────────────────────────────────────────────────────

build: build-server build-frontend ## Build server binary + frontend

build-server: ## Build Go binary → server/bin/server
	cd server && go build -o bin/server .

build-frontend: ## Build frontend for production → frontend/dist/
	cd frontend && npm run build

# ─── Test ──────────────────────────────────────────────────────────────────────

test: ## Run Go tests (DB-dependent tests skip if no test DB)
	cd server && TEST_DATABASE_URL="$(TEST_DB_URL)" go test ./...

test-v: ## Run Go tests, verbose
	cd server && TEST_DATABASE_URL="$(TEST_DB_URL)" go test -v ./...

test-run: ## Run one test by name: make test-run T=TestTransactionRepo_Reconcile
	cd server && TEST_DATABASE_URL="$(TEST_DB_URL)" go test -v -run "$(T)" ./...

# ─── Code quality ──────────────────────────────────────────────────────────────

fmt: ## Format Go source
	cd server && gofmt -w .

vet: ## Run go vet
	cd server && go vet ./...

lint-fe: ## Lint frontend TypeScript
	cd frontend && npm run lint

check: vet build ## Quick sanity check: vet + full build

# ─── Dev database ──────────────────────────────────────────────────────────────

db-reset: ## ⚠ Wipe ALL dev data — run 'make server' to re-apply migrations
	psql "$(DB_URL)" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;"
	@echo "✓ Dev DB wiped. Run 'make server' to re-apply migrations."

db-psql: ## Open a psql shell on the dev DB
	psql "$(DB_URL)"

db-dump: ## Print current schema (no data)
	pg_dump --schema-only "$(DB_URL)"

# ─── Test database ─────────────────────────────────────────────────────────────

test-db-create: ## Create the test DB (run once after first podman-compose up)
	createdb "$(TEST_DB_URL)" 2>/dev/null || echo "already exists"

test-db-reset: ## ⚠ Wipe test DB — fresh slate for integration tests
	psql "$(TEST_DB_URL)" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;"
	@echo "✓ Test DB wiped. Tests will re-apply migrations automatically."

# ─── Containers ────────────────────────────────────────────────────────────────

up: ## Start postgres container only
	podman-compose up -d postgres

up-all: ## Start all containers (postgres + server + frontend)
	podman-compose up -d

down: ## Stop and remove containers
	podman-compose down

logs: ## Tail all container logs
	podman-compose logs -f

# ─── Misc ──────────────────────────────────────────────────────────────────────

tidy: ## go mod tidy
	cd server && go mod tidy
