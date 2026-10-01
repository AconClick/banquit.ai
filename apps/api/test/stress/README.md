# Stress kit

Load, concurrency and billing checks run before go-live (2026-10-01). The concurrency and
tenant-isolation checks also run in CI as `test/concurrency.e2e-spec.ts` and
`test/isolation.e2e-spec.ts`.

Use a throw-away database: the seed drops it first.

```bash
cd apps/api && npm run build
export MONGO_URL=mongodb://127.0.0.1:27017/banquet_stress
export PROBE_OUT=/tmp            # where seed.json and fuzz results are written

npm run stress:fuzz              # 20,000 random bills through the bill maths
npm run stress:seed              # 3 sized tenants + 40 small ones, ~225,000 bookings (about a minute)
PORT=3100 node dist/main.js &    # the API on the seeded database
SECONDS=20 npm run stress:load -- $PROBE_OUT/seed.json http://127.0.0.1:3100 single mixed chain > results.json
```

`SMALL_TENANTS` changes the number of small tenants. Scenarios: `single` (each screen alone, per
tenant size), `mixed` (10 to 200 users across all tenants), `chain` (everyone on the largest tenant).

Use a real MongoDB for the numbers and races: FerretDB does not run `findOneAndUpdate` atomically, so
it reports races that MongoDB does not have.
