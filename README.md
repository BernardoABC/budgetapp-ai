A self-hosted personal finance tracker built for Costa Rica. Import QIF exports from your bank, auto-categorize transactions based on past behavior, and view your finances in CRC or USD with historically accurate exchange rates.

Inspired by YNAB's zero-based budgeting philosophy.

## Features

- **QIF Import** — Import transaction exports from Costa Rican banks (BAC, BCR, BN). Handles DD/MM/YYYY dates and CRC number formatting.
- **Auto-Categorization** — The app learns which payees map to which categories. After the first import, recurring merchants like Walmart, Farmacia La Bomba, and Global Vía are categorized automatically.
- **Dual Currency (CRC / USD)** — Toggle between colones and dollars at any time. Each transaction stores the exchange rate from its date, so conversions are historically accurate.
- **Zero-Based Budgeting** — Give every colon a job. Assign money to categories each month and track spending against your budget in real time.
- **Self-Hosted** — Runs entirely on your machine via Podman. Your financial data never leaves your computer.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript (Vite) |
| Backend | Go |
| Database | PostgreSQL 18 |
| Infrastructure | Podman + Podman Compose |
| Exchange Rates | BCCR (Banco Central de Costa Rica) |

## Getting Started

### Prerequisites

- [Podman](https://podman.io/getting-started/installation) and Podman Compose

That's it.

### Installation

```bash
git clone <repo-url>
cd budgetapp
podman compose up -d
```

The first run will:
1. Pull PostgreSQL 18
2. Build the Go server and React frontend
3. Run database migrations and seed default categories
4. Start all three services

Open **http://localhost:5173** in your browser.

### Stopping

```bash
podman compose down        # Stop containers, preserve data
podman compose down -v     # Stop containers and DELETE all data
```

## Usage

### Import Transactions

1. Export a QIF file from your bank's online portal
2. Click **Import** in the top navigation
3. Select your target account and upload the file
4. Review auto-categorized transactions — accept, override, or skip as needed
5. Confirm to commit

The app learns from every categorization decision. Future imports from the same merchants will be categorized automatically.

### Set Up a Budget

1. Navigate to **Budget**
2. Select the current month
3. Click on any category's **Assigned** cell and enter an amount
4. Distribute your **Ready to Assign** balance until it reaches zero

### Currency Toggle

Use the **₡ CRC / $ USD** toggle in the top-right to switch views. Exchange rates are fetched automatically from the Banco Central de Costa Rica for each transaction date.

## Development

### Project Structure

```
budgetapp/
├── podman-compose.yml
├── AGENTS.md              # AI coding conventions (read before contributing)
├── docs/prd/              # Product requirements documents
├── server/                # Go backend
│   ├── main.go
│   └── internal/
│       ├── config/
│       ├── database/migrations/
│       ├── handler/
│       ├── model/
│       ├── repository/
│       ├── service/
│       └── qif/
└── frontend/              # React frontend
    └── src/
        ├── api/
        ├── components/
        ├── pages/
        ├── hooks/
        ├── context/
        ├── types/
        └── utils/
```

### Useful Commands

```bash
# View logs
podman compose logs -f server
podman compose logs -f frontend

# Access the database
podman compose exec postgres psql -U ynab -d ynab

# Rebuild after code changes (hot-reload handles most cases)
podman compose build server
podman compose up -d server
```

### Database Migrations

Migrations live in `server/internal/database/migrations/` as numbered SQL files (`001_initial_schema.sql`, etc.). They run automatically on server startup.

To add a migration, create the next numbered file. Never edit a migration that has already been applied — add a new one instead.

## Documentation

Detailed product requirements and design decisions are in `docs/prd/`:

| Document | Contents |
|----------|----------|
| `00-project-overview.md` | Vision, architecture, delivery phases |
| `01-data-model.md` | Database schema, all tables and columns |
| `02-qif-import-and-auto-categorization.md` | QIF parsing, payee matching, import workflow |
| `03-multi-currency.md` | CRC/USD conversion, exchange rate strategy |
| `04-budgeting.md` | Zero-based budgeting logic and UI |
| `05-transaction-management.md` | Transaction CRUD, filtering, search |
| `06-accounts-and-dashboard.md` | Account types, dashboard widgets |
| `07-reports-and-analytics.md` | Spending reports and charts |
| `08-api-design.md` | Full REST API reference |
| `09-infrastructure.md` | Podman setup, environment variables |
| `10-ui-design.md` | Frontend architecture, component structure |
| `11-implementation-roadmap.md` | Phased build plan with concrete steps |

## Configuration

Environment variables are set in `podman-compose.yml`. For local overrides, create a `.env` file in the project root (it is git-ignored).

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (set in compose) | PostgreSQL connection string |
| `PORT` | `8080` | Go server port |
| `VITE_API_URL` | `http://localhost:8080` | Backend URL for the frontend |

## Data & Privacy

All data is stored in a local Podman volume (`pgdata`). Nothing is sent to any external service except exchange rate lookups to the BCCR API. You can disable external requests entirely by setting exchange rates manually.

> **Note:** The `.qif` file in the project root is a development sample only and is git-ignored. Do not commit files containing real transaction data.
