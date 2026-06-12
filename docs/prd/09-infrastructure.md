# PRD 09: Infrastructure & Podman Setup

## Overview
The entire stack runs in Podman containers via Podman Compose. Three services: React frontend, Go backend, PostgreSQL database.

## Podman Compose Architecture

```
┌─────────────────────────────────────────────┐
│  docker-compose.yml                         │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ frontend │  │  server  │  │  postgres  │  │
│  │ :5173    │──│  :8080   │──│   :5432    │  │
│  │ (Vite)   │  │  (Go)    │  │  (PG 18.3)│  │
│  └─────────┘  └──────────┘  └───────────┘  │
│                                             │
│  Volume: pgdata (persistent)                │
└─────────────────────────────────────────────┘
```

## docker-compose.yml Structure (read by Podman Compose)

```yaml
services:
  postgres:
    image: postgres:18.3-alpine
    environment:
      POSTGRES_DB: budgetapp
      POSTGRES_USER: budgetapp
      POSTGRES_PASSWORD: budgetapp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U budgetapp"]
      interval: 5s
      timeout: 5s
      retries: 5

  server:
    build:
      context: ./server
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://budgetapp:budgetapp@postgres:5432/budgetapp?sslmode=disable
      PORT: 8080
      EXCHANGE_RATE_API_URL: https://api.exchangerate.host
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./server:/app  # For development hot-reload

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:8080
    depends_on:
      - server
    volumes:
      - ./frontend:/app
      - /app/node_modules  # Prevent overwriting node_modules

volumes:
  pgdata:
```

## Dockerfiles

### server/Dockerfile
```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server ./main.go

# Runtime stage
FROM alpine:3.19
COPY --from=builder /server /server
EXPOSE 8080
CMD ["/server"]
```

Development mode uses the Go source with air (hot-reload tool) instead of the compiled binary.

### frontend/Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

## Development Workflow

### First-time setup
```bash
git clone <repo>
cd budgetapp
podman compose up -d
```

This will:
1. Start PostgreSQL and wait for it to be healthy
2. Start the Go server, which runs migrations automatically on startup
3. Start the Vite dev server with hot module replacement

### Daily development
```bash
podman compose up -d        # Start all services
podman compose logs -f server  # Watch server logs
podman compose down         # Stop all services
```

### Database access
```bash
podman compose exec postgres psql -U budgetapp -d budgetapp
```

### Reset database
```bash
podman compose down -v      # Remove volumes (destroys data)
podman compose up -d        # Recreate with fresh migrations
```

## Environment Variables

### Server
| Variable | Default | Description |
|----------|---------|-------------|
| DATABASE_URL | required | PostgreSQL connection string |
| PORT | 8080 | HTTP server port |
| EXCHANGE_RATE_API_URL | https://api.exchangerate.host | Exchange rate API base URL |
| BCCR_API_URL | (BCCR SOAP endpoint) | BCCR exchange rate API |
| CORS_ORIGIN | http://localhost:5173 | Allowed CORS origin (dev only) |

### Frontend
| Variable | Default | Description |
|----------|---------|-------------|
| VITE_API_URL | http://localhost:8080 | Backend API base URL |

## Project Directory Structure

```
budgetapp/
├── docker-compose.yml
├── .gitignore
├── README.md
├── docs/
│   └── prd/                   # These PRD documents
│       ├── 00-project-overview.md
│       ├── ...
├── server/
│   ├── Dockerfile
│   ├── main.go
│   ├── go.mod
│   └── internal/
│       ├── config/
│       ├── database/
│       ├── handler/
│       ├── model/
│       ├── repository/
│       ├── service/
│       └── csvparser/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/               # API client functions
│       ├── components/        # Reusable UI components
│       ├── pages/             # Route-level components
│       ├── hooks/             # Custom React hooks
│       ├── types/             # TypeScript interfaces
│       ├── utils/             # Formatting, currency helpers
│       └── context/           # React context (currency toggle, etc.)
├── ejemplo_crc.qif            # Sample bank export (QIF format, CRC)
├── ejemplo_usd.csv            # Sample bank export (CSV format, USD)
└── ejemplo_usd.txt            # Sample bank export (MT940 format, USD)
```

## Production Considerations (Future)

For production deployment (not v1):
- Go server serves the React build as static files (no separate frontend container)
- Use multi-stage Podman build for minimal image size
- Add HTTPS via reverse proxy (Caddy/nginx)
- Use Podman secrets instead of env vars for database password
- Add backup strategy for PostgreSQL volume
- Consider adding pgAdmin container for DB management
