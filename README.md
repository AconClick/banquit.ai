# Banquit.ai

BanquetFlow / Banquet.ai: a multi-tenant SaaS for hotels and restaurants, from a single banquet hall to luxury hotel chains, to manage banquet enquiries, bookings, menus and billing.

- **Specs:** [docs/](docs/README.md)
- **Backend:** [apps/api](apps/api) (NestJS, MongoDB)
- **Frontend:** [apps/web](apps/web) (Angular)

Each client gets its own sub-domain (for example `prime.banquet.ai`) and can also use its own domain.

## Run it locally

Needs Node.js 24 (see `.nvmrc`) and MongoDB on `localhost:27017`.

```bash
# Backend: http://localhost:3000/api
cd apps/api
npm install
npm run build
npm run seed        # creates the demo client "prime" and logs the entp password
npm run start:dev

# Frontend: http://localhost:4200 (calls the backend through a proxy)
cd apps/web
npm install
npm start
```

Open http://localhost:4200, enter the domain `prime`, log in as `entp` with the password from the seed output, and choose a new password. In development, emails and SMS codes (OTP) are printed in the backend console instead of being sent.

## Tests

```bash
cd apps/api && npm test && npm run test:e2e   # e2e needs MongoDB (MONGO_URL)
cd apps/web && npm test
```

## Settings (backend environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `MONGO_URL` | `mongodb://127.0.0.1:27017/banquetai` | Database |
| `BASE_DOMAIN` | `banquet.ai` | Clients are served at `<subdomain>.<BASE_DOMAIN>` |
| `ALLOW_TENANT_HEADER` | `true` | Lets localhost and `app.<BASE_DOMAIN>` pick the client with the `X-Tenant` header. Set to `false` in production |
| `JWT_SECRET` | dev value | Signs session tokens. **Must be set in production** |
| `PLATFORM_ADMIN_TOKEN` | dev value | Protects Banquet.ai's own admin endpoints (`/api/platform/...`). **Must be set in production** |
| `NOTIFY_PROVIDER` | `console` | `aws` sends SMS through Amazon SNS and email through Amazon SES |
| `AWS_REGION` | `ap-south-1` | Region for SNS and SES |
| `MAIL_FROM` | `no-reply@banquet.ai` | Sender address for emails |
