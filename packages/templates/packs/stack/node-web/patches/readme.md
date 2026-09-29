1. Install Node 22 and enable pnpm with `corepack enable`, then run `pnpm install`.
2. Copy `.env.example` to `.env`, start Postgres with `docker compose up -d db`, then run `pnpm db:bootstrap`.
3. Run `pnpm dev` for the API on port 3000 and `pnpm dev:web` for the UI on port 5173.
