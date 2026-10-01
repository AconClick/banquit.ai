# Security review (2026-10-01)

A review of the whole app before go-live: login and sessions, OTP, rate limits, input validation,
HTTP headers, secrets and dependencies. Tenant isolation was checked separately in the stress test
(`reports/stress-test-2026-10-01.md`) and found clean.

## Fixed

| # | Finding | Risk | Fix |
|---|---------|------|-----|
| 1 | The login token was kept in `sessionStorage`, where any injected script can read it. | High | The token now lives in an `httpOnly`, `SameSite=Strict` cookie (`__Host-bq_session` over HTTPS) that page scripts cannot read. Login responses no longer carry the token. |
| 2 | Cookie sessions can be abused by another site's form (CSRF). | High (with 1) | Changes made by cookie must send `X-Banquet-Csrf: 1`, which a cross-site form cannot add. `SameSite=Strict` blocks it as well. |
| 3 | CORS reflected every origin with credentials. | High (with 1) | CORS is off; the web app and API share a host. `CORS_ORIGINS` can list origins if ever needed. |
| 4 | No per-IP limits on login, password reset, OTP, sign-up or the support console login. | Medium | Per-IP limits stored in MongoDB (shared by every container), plus an overall cap per IP. Master-panel SMS codes are capped at 6 per user per hour. |
| 5 | `trust proxy` trusted every hop, so anyone could fake their IP with `X-Forwarded-For` and dodge limits. | Medium | Only the configured number of proxies is trusted (`TRUST_PROXY=2` behind CloudFront and the load balancer). |
| 6 | Parallel wrong OTP guesses could all be counted as one, getting past the 3-attempt limit; a correct code could be used twice in parallel. | Medium | Attempts are claimed atomically before checking; a code is single use. |
| 7 | Development secrets (`JWT_SECRET`, `PLATFORM_ADMIN_TOKEN`) and the console notifier (which logs passwords and codes) would be used silently if production forgot to set them. | High | A production start refuses to run without strong secrets, `MONGO_URL` and `NOTIFY_PROVIDER=aws`. |
| 8 | The `X-Tenant` header could pick the tenant in production. | Low (tokens are tenant-bound) | Off by default in production. |
| 9 | A support session inside a client kept working after the staff member logged out of the console or was disabled. | Medium | The session stops as soon as the staff member logs out or is disabled. |
| 10 | Wrong user ids answered faster than wrong passwords, revealing which ids exist. | Low | A wrong user id now costs the same password check. |
| 11 | No security headers; `X-Powered-By` exposed the framework. | Low | Helmet: `nosniff`, deny framing, `default-src 'none'` for API responses, HSTS in production. |
| 12 | Unused deploy tool `@nestjs/mau` pulled in packages with known vulnerabilities (`tmp`, `undici`). | Low (dev only) | Removed. `npm audit` is clean for both apps. |

## Checked and fine

- **Logout and new login end old sessions.** Each user has one session id; logout clears it, a new login replaces it, a password reset clears it, a disabled user is refused, and idle sessions end after 30 minutes. Covered by e2e tests.
- **Input validation.** Every body uses class-validator with unknown fields rejected; master records are checked field by field against their definitions; query strings are parsed flat, so `?a[$ne]=` cannot inject MongoDB operators.
- **Passwords.** bcrypt, history of 3, lockout after 5 wrong tries, reset links hashed and valid 30 minutes, forgot-password answers the same whether or not the user exists.
- **Tokens.** Bound to one tenant and checked on every request, with token types (user, support console, support session) kept apart.

## For other modules (not changed here)

- The support console's own token is still in `sessionStorage` (`apps/web/src/app/support/support-api.ts`). Move it to a cookie with the helper in `apps/api/src/auth/session-cookie.ts`.
- Support console OTP attempts (`support.service.ts`) use the same read-then-save pattern as finding 6.
- Console logout could also mark that staff member's active client sessions as ended in the client's Support Access log (they already stop working).

## Still to do before go-live

- A penetration test by an outside firm once the app is on AWS.
- AWS WAF in front of CloudFront (managed rule sets plus a rate rule) is in `infra/aws/web.tf`; watch its blocks in the first weeks.
- Rotate `JWT_SECRET` and `PLATFORM_ADMIN_TOKEN` through Secrets Manager; rotating `JWT_SECRET` logs everyone out.
- Replace the shared `PLATFORM_ADMIN_TOKEN` with named admin logins when the admin console is built.
