# Budget App — Frontend

React 19 + TypeScript + Vite frontend for the budget app.

## Requirements

- Node 22+
- Podman (for containerized runs)

## Local development

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with HMR enabled.

## Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |

## Linting

ESLint is configured with type-aware TypeScript rules and React-specific plugins:

- `typescript-eslint` — `recommendedTypeChecked` + `stylisticTypeChecked`
- `eslint-plugin-react-hooks` — hooks rules
- `eslint-plugin-react-refresh` — fast-refresh safety
- `eslint-plugin-react-x` — React best practices (TypeScript-aware)
- `eslint-plugin-react-dom` — DOM-specific React rules

## Running with Podman

Build the image:

```bash
podman build -t budgetapp-frontend .
```

Run the container:

```bash
podman run --rm -p 8080:80 budgetapp-frontend
```

The app is served by nginx at `http://localhost:8080`.

## React Compiler

The [React Compiler](https://react.dev/learn/react-compiler) is enabled via `babel-plugin-react-compiler`. It automatically memoizes components and hooks at build time. This may slightly increase build times.
