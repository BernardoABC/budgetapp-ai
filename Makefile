# ─── Config ────────────────────────────────────────────────────────────────────

DB_URL      ?= postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable
TEST_DB_URL ?= postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable
REGISTRY    ?= localhost:5000
TAG         ?= latest

.DEFAULT_GOAL := help

.PHONY: help \
        server frontend \
        build build-server build-frontend \
        build-images push-images deploy ship \
        test test-v test-run \
        fmt vet lint-fe check \
        db-reset db-psql db-dump \
        k3s-db-reset \
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

# ─── Container images ──────────────────────────────────────────────────────────

build-images: ## Build server + frontend container images
	podman build -t $(REGISTRY)/budgetapp-server:$(TAG) -f server/Containerfile server/
	podman build -t $(REGISTRY)/budgetapp-frontend:$(TAG) --build-arg VITE_API_URL="" -f frontend/Containerfile frontend/

push-images: ## Push images to local registry (requires registry pod running)
	podman push $(REGISTRY)/budgetapp-server:$(TAG)
	podman push $(REGISTRY)/budgetapp-frontend:$(TAG)

deploy: ## Apply k3s manifests (assumes images already pushed)
	kubectl apply -f $(HOME)/homelab/k3s/budgetapp/
	kubectl apply -f $(HOME)/homelab/k3s/caddy/configmap.yaml
	kubectl rollout restart deployment/caddy -n homelab

ship: build-images push-images deploy ## Build, push, and deploy in one shot
	kubectl rollout restart deployment/budgetapp-server deployment/budgetapp-frontend -n homelab

k3s-db-reset: ## ⚠ Wipe k3s DB data — server restarts and re-applies migrations
	kubectl exec deployment/budgetapp-db -n homelab -- psql -U budgetapp -d budgetapp -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;"
	kubectl rollout restart deployment/budgetapp-server -n homelab
	@echo "✓ k3s DB wiped. Server is restarting to re-apply migrations."

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
