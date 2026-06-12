# PRD 00: Project Overview & Vision

## Project Name
**budgetapp** — A Monarch-style personal finance tracker built for Costa Rica

## Problem Statement
Existing budgeting tools (YNAB, Mint, etc.) have poor support for:
- Costa Rican bank file formats (CSV exports from banks like BAC, BCR, BN)
- Multi-currency workflows where daily expenses are in CRC but savings/investments may be in USD
- Auto-categorization of local merchants (Walmart Curridabat, AM PM, Farmacia La Bomba, etc.)

Users who bank in Costa Rica need a tool that understands their transaction exports, learns their spending patterns, and lets them view their finances in either CRC or USD at historically accurate exchange rates.

## Target User
- Primary: A single user (the developer) managing personal finances across CRC and USD
- The app is self-hosted via Podman — no multi-tenant concerns for v1

## Core Value Propositions
1. **CSV Import with Smart Categorization** — Import bank exports and have transactions auto-categorized based on previously categorized payees
2. **Dual-Currency View** — Toggle between CRC and USD views; each transaction stores the exchange rate at time of import
3. **Spending Plan** — Monarch-style monthly forecast: set expected income, plan by category, track left-to-budget and savings rate
4. **Cash Flow** — Income vs. spending chart with savings rate and flexibility-bucket breakdown
5. **Local-First** — Self-hosted, no cloud dependency, full data ownership

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 19 (Vite + TypeScript), inline styles, hand-rolled SVG charts |
| UI Design | Dark-first; layered navy-charcoal; Plus Jakarta Sans + IBM Plex Mono; mint accent |
| Backend | Go (net/http or Chi router) |
| Database | PostgreSQL 18.3 |
| Containerization | Podman + Podman Compose |
| Exchange Rates | BCCR API (Banco Central de Costa Rica) or fallback to exchangerate.host |

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│              React SPA (Vite)                    │
└──────────────────┬──────────────────────────────┘
                   │ HTTP/JSON
┌──────────────────▼──────────────────────────────┐
│              Go API Server                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ CSV      │ │ Budget   │ │ Exchange Rate    │ │
│  │ Parser   │ │ Engine   │ │ Service          │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │ SQL
┌──────────────────▼──────────────────────────────┐
│             PostgreSQL 18.3                      │
│  accounts, transactions, categories,             │
│  budgets, monthly_plans, app_settings,           │
│  payee_rules, exchange_rates                     │
└─────────────────────────────────────────────────┘
```

## Phased Delivery Plan

### Phase 1: Foundation (MVP)
- Database schema & migrations
- CSV file parser (Go)
- Transaction CRUD API
- Account management
- Basic React UI: transaction list, account overview
- Podman Compose setup

### Phase 2: Smart Features
- Category management with payee-based auto-categorization
- CSV import UI with review/confirm workflow
- Exchange rate fetching and storage
- Dual-currency toggle (CRC/USD view)

### Phase 3: Spending Plan
- Monthly spending plan (expected income, planned amounts per category)
- Left-to-budget / planned savings calculation
- Rollover and flex budgeting (fixed / flexible / non-monthly categories)
- Cash Flow page (income vs. spending chart, savings rate)

### Phase 4: Polish
- Reports & analytics (spending by category, trends over time)
- Search & filtering
- Recurring transaction detection
- Data export

## Non-Goals for v1
- Mobile app
- Multi-user / authentication (single-user, localhost)
- Bank API direct sync (CSV import only)
- Reconciliation workflows
