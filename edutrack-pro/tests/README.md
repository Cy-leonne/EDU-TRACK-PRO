# Tests

```
tests/
└── smoke/smoke.mjs      black-box HTTP suite against a running API (this folder)
apps/api/test/
├── unit/                pure logic: validation, publication rules, scheduling constraints…
├── integration/         API + real database: persistence, auth/isolation, results, files, exports
├── e2e/journeys.spec.ts the ten end-to-end journeys from the product brief
└── support/             test app factory, database reset, fixtures, HTTP helpers
```

Why two locations: the Jest suites run *inside* the API package against a dedicated test database
(fast, isolated, transaction-aware), while `tests/smoke` is deliberately outside the build so you can
point it at any environment — including a staging or production deployment — without shipping test
code into the application.

## Running everything

```bash
# API unit + integration + E2E (needs PostgreSQL; uses TEST_DATABASE_URL)
npm run test:all

# black-box smoke suite (needs a running API — it only reads data)
node tests/smoke/smoke.mjs
API_URL=http://localhost:4000/api/v1 node tests/smoke/smoke.mjs

# mobile/type checks
npm run typecheck
```

See [docs/TESTING.md](../docs/TESTING.md) for coverage detail and how to add tests.
