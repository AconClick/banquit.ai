# Backup and restore (MongoDB Atlas)

All business data (bookings, bills, masters, users) is in one MongoDB Atlas database. The web app
and API hold nothing that is not in Git or in the database, so restoring the database restores the
business. Secrets live in AWS Secrets Manager and can be regenerated.

## Targets

| | Target | How |
|---|---|---|
| Data loss at most (RPO) | 1 minute | Atlas Continuous Cloud Backup (oplog), point-in-time restore |
| Back online within (RTO) | 2 hours | Restore to a new cluster, point the secret at it, restart the API |
| Kept for | 13 months | Atlas snapshots plus the export bucket in our AWS account |

## 1. Atlas Cloud Backup (main backup)

Needs an M10 or larger cluster. In Atlas > the cluster > Backup:

1. Turn on **Cloud Backup** and **Continuous Cloud Backup** with a 7-day restore window.
2. Set the snapshot policy:
   - every 6 hours, keep 2 days
   - daily, keep 14 days
   - weekly, keep 8 weeks
   - monthly, keep 13 months (covers a full financial year for audit questions)
3. Turn on **Backup Compliance Policy** once the policy is settled. Nobody, not even a project owner, can then delete snapshots or shorten retention. This protects against a stolen admin login.
4. Add a **second region copy** of snapshots, for example Hyderabad (`ap-south-2`), so a region-wide outage does not take the backups with it.

## 2. Off-site copy in our AWS account

Terraform creates the bucket `banquetai-prod-db-backups-<account>` (versioned, encrypted, private; Glacier after 35 days, deleted after 400). To have Atlas export snapshots there:

1. Atlas > Project > Integrations > **AWS IAM Role Access** > Authorize an AWS IAM role. Atlas shows its AWS account ARN and an external ID.
2. Put them in `infra/aws/terraform.tfvars` as `atlas_aws_account_arn` and `atlas_external_id`, run `terraform apply`, and give Atlas the role ARN it creates (`banquetai-prod-atlas-snapshot-export`).
3. Atlas > Backup > Export: add the bucket, then set the monthly snapshot to export automatically.

## 3. Restore

### A mistake in the data (e.g. someone deleted bookings at 14:05)

Never restore over the live cluster for this: it would also roll back every good change since.

1. Atlas > Backup > Restore > **Point in Time**: choose 14:04, restore to a **new temporary cluster** (`banquetai-restore`).
2. Connect with `mongosh` or Compass, find the records, and copy only them back (for example `mongoexport` with a query on `tenantId` and dates, then `mongoimport --mode=upsert` into the live cluster).
3. Delete the temporary cluster.

### The live cluster is lost or corrupted

1. Atlas > Backup > Restore > Point in Time (or the latest snapshot) into a **new cluster** in Mumbai.
2. Add the NAT IP (`terraform output atlas_allow_ip`) to Network Access if the project changed, and create the app database user on the new cluster.
3. Point the API at it and restart:
   ```sh
   aws secretsmanager put-secret-value --secret-id banquetai-prod/mongo-url --secret-string '<new connection string>'
   aws ecs update-service --cluster banquetai-prod --service api --force-new-deployment
   ```
4. Check `https://app.banquet.ai/api/health/ready`, log in as a test tenant, and open the diary and a bill.
5. Tell affected hotels the time window that was lost, if any.

### From the S3 export only (Atlas project gone)

Exports are files per collection. Create a new cluster, download the export from the bucket, and load each collection with `mongoimport`. Then recreate indexes by starting the API once, since Mongoose builds them on start. Continue from step 3 above.

## 4. Restore drill

Do this before go-live and then every quarter. Write the date and the time each step took in the table below.

1. Point-in-time restore of production to a temporary cluster, at "one hour ago".
2. Start the API locally against it (`MONGO_URL=<temp> npm run start:dev` in `apps/api`), log in to a tenant and open last week's bills.
3. Compare counts with production: `db.reservations.countDocuments()`, `db.bills.countDocuments()`.
4. Delete the temporary cluster.

| Date | Who | Restore took | Checks passed | Notes |
|------|-----|--------------|---------------|-------|
| | | | | |

## Not covered by these backups

- **Notifications already sent** (emails and SMS) cannot be recalled after a restore.
- **Rate-limit counters** (`ratelimits` collection) need no backup; they expire on their own.
