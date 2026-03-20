# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CineAI Studio is a Tauri v2 + React 19 desktop application for cinematic AI production. It handles storyboard import (Film-kit SHOT*.md files), AI image/video generation (FAL-AI, TensorPix), asset management, character references, and job queue orchestration. UI strings are in Turkish.

## Commands

```bash
npm run tauri -- dev     # Full desktop app (Tauri + Vite dev server on port 1420)
npm run dev              # Web frontend only (no Tauri shell)
npm run build            # TypeScript check + Vite production build
npm test                 # Run all Vitest tests
npx vitest run src/lib/bulk-production.test.ts  # Run a single test file
```

Package manager is pnpm (locked at 10.29.2), but scripts are invoked via `npm run`.

## Architecture

**Stack**: Tauri v2 (Rust shell) → React 19 + React Router v7 + Zustand v5 + TanStack React Query v5 + Tailwind CSS v4/Shadcn

**Layer separation**:
- `src/screens/` — Page-level React components, one directory per route (11 screens)
- `src/components/` — Reusable UI: layout shell (AppLayout, Sidebar, TopBar), shot/asset/job cards, Shadcn primitives
- `src/services/` — Stateless business logic functions (~18 service files). All state lives in Zustand stores or SQLite; services never hold state themselves
- `src/lib/` — Pure helper functions with no side effects (parsing, defaults resolution, prompt composition). This is the only layer with unit tests
- `src/store/` — Three Zustand stores: `project.store` (active project), `queue.store` (job list + concurrency), `ui.store` (active screen, sidebar)
- `src/db/` — SQLite via `@tauri-apps/plugin-sql`. Lazy connection pool keyed by path. Migrations run on first connect

**Three persistence layers**:
1. **Zustand stores** — in-memory, per-session UI/queue state
2. **Tauri Store** (`settings.dat`) — persistent key-value config (API keys, model defaults, parallel limit). Access via `src/lib/store.ts`
3. **SQLite** — structured data (projects, shots, assets, characters, character_looks, job_queue, cost_logs). Two-database pattern: workspace DB (`cineai.db` in app config dir) for project registry, plus per-project DBs in hashed subdirectories

**Bootstrap flow** (`src/main.tsx`): QueryClient setup → `FoundationBootstrap` component runs `initializeJobQueuePersistence()` + `hydrateAppState()` + `bootstrapFoundation()` (workspace DB init, FAL client init) → `AppRouter` renders

**Key services by size/importance**:
- `jobqueue.service.ts` (~1400 LOC) — Job execution engine with concurrency control, retry, error handling
- `character.service.ts` (~970 LOC) — Character CRUD, looks management, generation prompts, asset binding
- `import.service.ts` (~740 LOC) — Storyboard markdown parsing and shot CRUD
- `fal.service.ts` (~590 LOC) — FAL-AI client for image/video generation, model definitions

## Database

SQLite schema is defined in `src/db/migrations/001_initial.sql`. Dynamic migrations in `src/db/index.ts` add columns and tables incrementally (using `PRAGMA table_info` to check before `ALTER TABLE`). Key tables: `projects`, `shots` (extensive columns for camera/prompt/status/character data), `assets`, `characters`, `character_looks`, `job_queue`, `cost_logs`, `prompt_templates`, `model_presets`.

The SQL plugin uses `$1`, `$2` style positional parameters (not `?`).

## Testing

Tests cover only the `src/lib/` pure helper layer. Test files are `*.test.ts` (not `.tsx`). Vitest runs in Node environment. The `@` path alias resolves to `src/` in both Vite and Vitest configs.

## TypeScript

Strict mode enabled. Path alias `@/*` → `./src/*`. No unused locals or parameters allowed (`tsconfig.json`).
