# Monitoring, logs and alerts

## Health checks

| URL | Meaning | Used by |
|---|---|---|
| `GET /api/health` | The process is up. Returns the running version. | Container health check |
| `GET /api/health/ready` | Up **and** MongoDB answers a ping within 2 s, else `503`. | Load balancer, Route 53 outside check |

Health checks skip tenant lookup and rate limits, and successful ones are not logged.

## Logs

In production the API writes one JSON line per event to CloudWatch Logs (`/banquetai/prod/api`, kept 90 days).

- Every request: `requestId`, `method`, `path` (never the query string), `status`, `ms`, `tenant`, `user`, `ip`. Bodies are never logged.
- Every response carries `X-Request-Id`. When a hotel reports a problem, ask for the time and, if they can see it, the request id.
- Server errors return only "Something went wrong" plus the `requestId` to the client; the stack goes to the log.

Useful CloudWatch Logs Insights queries:

```
# Slowest endpoints in the last hour
fields message.path as path, message.ms as ms
| filter context = "HTTP"
| stats avg(ms), pct(ms, 95), count() by path
| sort pct(ms, 95) desc | limit 20

# Everything that happened in one request
fields @timestamp, level, message
| filter message.requestId = "PASTE-ID" or requestId = "PASTE-ID"

# Errors by tenant today
filter level = "error" | stats count() by message.tenant
```

## Alerts

All alarms email `alert_email` (set in `infra/aws/terraform.tfvars`) when they fire and when they clear.

| Alarm | Fires when | First thing to check |
|---|---|---|
| `site-down` | `app.<domain>/api/health/ready` fails from 3 regions for 2 minutes | ECS service events; Atlas status |
| `api-unhealthy` | A container fails the load balancer check for 10 minutes | Logs around the time; Atlas Network Access IP |
| `api-5xx` | 10+ server errors in 5 minutes | Logs Insights: `filter level = "error"` |
| `api-error-logs` | 5+ error log lines in 5 minutes | Same; also catches errors outside requests |
| `api-slow` | p95 response time over 2 s for 15 minutes | Slowest endpoints query; Atlas Performance Advisor |
| `api-cpu` / `api-memory` | Over 85% for 15 minutes | Already scaled to the maximum? Raise `api_max_tasks` |
| `edge-5xx` | Over 5% of all requests fail at CloudFront | Origin down or WAF misfiring |

Also set these up in **MongoDB Atlas > Alerts** (Atlas watches the database itself):

- Replica set has no primary
- Disk space used over 75%
- Connections over 80% of the limit
- Backup snapshot failed, and the continuous backup oplog falling behind
- Query targeting (scanned/returned) over 1000, which means a missing index

## Error tracking

Unexpected errors go through `ErrorReporter` (`apps/api/src/common/observability.ts`). Today it writes them to the log, which the `api-error-logs` alarm counts. To use Sentry or a similar tool later, add its SDK, implement `ErrorReporter.report()` with it, and register that class in `app.module.ts` in place of `LogErrorReporter`. Nothing else changes.

## Dashboards

ECS Container Insights is on (CPU, memory and task counts per service). WAF has a metric per rule (`rate-limit`, `common`, ...), so a jump in blocks shows an attack or a rule blocking real users. For the latter, look at sampled requests in the WAF console.
