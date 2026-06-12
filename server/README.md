# budgetapp — server

Go HTTP API server for budgetapp.

## Stack

| | |
|---|---|
| Language | Go 1.26.2 |
| Router | chi v5 |
| Database | PostgreSQL 18.3 (pgx/v5) |
| Container | Podman |

## Running

```bash
podman build -t budgetapp-server -f Containerfile .
podman run -e DATABASE_URL=postgres://budgetapp:budgetapp@localhost:5432/budgetapp -p 8080:8080 budgetapp-server
```

Or via the project root:

```bash
cd ..
podman compose up -d server
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PORT` | `8080` | HTTP listen port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |

## Project Layout

```
server/
├── main.go
├── go.mod
├── Containerfile
└── internal/
    ├── config/        env var loading
    ├── database/      connection pool + migration runner
    ├── handler/       HTTP handlers (thin: parse → service → respond)
    ├── model/         structs only, no logic
    ├── repository/    all SQL queries
    ├── service/       business logic
    └── csvparser/     bank CSV parser
```

## API

Base path: `/api`. All responses are JSON. Amounts are `int64` minor units (centimos/cents).

See `docs/prd/08-api-design.md` for the full endpoint reference.

## Development

After changing dependencies:

```bash
go mod tidy
```

To verify the build:

```bash
go build ./...
```
