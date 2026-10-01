# Going live on AWS

Everything AWS needs is described as code in `infra/aws` (Terraform) and shipped by
`.github/workflows/deploy.yml`. This page is the checklist, in order. Steps marked **You** need a
person with the account; the rest are commands.

## What gets built

```
visitor ──> CloudFront + WAF ──┬── /*      ──> S3 (Angular app)
 (prime.banquet.ai,            └── /api/*  ──> load balancer ──> API containers (ECS Fargate, 2–6)
  app.banquet.ai, ...)                                              │
                                                                    ├── MongoDB Atlas (via fixed NAT IP)
                                                                    ├── SES (email), SNS (SMS)
                                                                    └── Secrets Manager (keys)
```

- **Region:** Mumbai (`ap-south-1`). CloudFront certificates and WAF sit in `us-east-1`, as AWS requires.
- **One host per tenant:** `*.banquet.ai` points at CloudFront, which forwards the host name to the API, which picks the tenant from it. The session cookie is tied to that exact host.
- **API containers** run in private subnets, two at least (one can fail or be replaced with no downtime), more when CPU passes 60%. The load balancer accepts traffic from CloudFront only, checked by IP range and a secret header.
- **Releases** build an image, roll it out, and roll back on their own if the new containers do not pass `/api/health/ready`.

Rough monthly cost at launch: about US$150–220. That covers 2 small Fargate tasks, the NAT gateway, the load balancer, WAF, CloudFront and CloudWatch. MongoDB Atlas is billed separately, from about US$60 for M10.

## 1. Accounts and domain (You)

1. Create the AWS account. Turn on MFA for the root user, then create an admin IAM Identity Center user for daily work.
2. Set a **billing alarm** (Billing > Budgets), for example at US$300 per month.
3. Decide the domain. The code assumes `banquet.ai`; anything else is one variable.
4. MongoDB Atlas: use **M10 or larger** for production. M0/M2/M5 have no continuous backup and no point-in-time restore. Pick the Mumbai (`ap-south-1`) region and turn on **Cloud Backup with Continuous Cloud Backup**. See [backup-and-restore.md](backup-and-restore.md).
5. Create an Atlas database user for the app with `readWrite` on the `banquetai` database only. Use a long generated password.

## 2. Terraform state bucket (one time)

```sh
aws s3api create-bucket --bucket banquetai-terraform-state --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket banquetai-terraform-state --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket banquetai-terraform-state \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Then uncomment the `backend "s3"` block in `infra/aws/versions.tf`. The state holds generated secrets, so only admins should read this bucket.

## 3. Build the infrastructure

```sh
cd infra/aws
cp terraform.tfvars.example terraform.tfvars   # set alert_email
terraform init
terraform apply
```

The first apply waits on DNS validation of the certificates. If the domain was bought elsewhere, set its name servers to the `name_servers` output at the registrar while the apply is running (or run apply again afterwards).

**You:** confirm the two "AWS Notification - Subscription Confirmation" emails sent to `alert_email`.

## 4. Connect MongoDB Atlas

1. Atlas > Network Access: add the `atlas_allow_ip` output (all API traffic leaves through it). Remove `0.0.0.0/0` if it is there.
2. Store the connection string. It never goes in code or in the task definition:
   ```sh
   aws secretsmanager put-secret-value --secret-id "$(terraform output -raw mongo_url_secret)" \
     --secret-string 'mongodb+srv://banquetai-app:<password>@<cluster>.mongodb.net/banquetai?retryWrites=true&w=majority'
   ```
3. Optional but recommended: set up the off-site snapshot export (see [backup-and-restore.md](backup-and-restore.md)).

## 5. Email and SMS (You, takes days, start early)

- **SES production access:** new accounts can only email verified addresses. In SES > Account dashboard, request production access. Describe it as transactional email only: login details, password resets, support access notices.
- **SMS for India:** Master-panel codes are sent by SMS. Indian carriers deliver only with a registered **Sender ID** and a **DLT template** (TRAI rules). Register the entity and template on a DLT portal (for example Jio, Vodafone Idea or Airtel), then add the Sender ID and template ID in SNS > Text messaging. Also request an SMS spending limit above the US$1 default (Terraform asks for US$100). Until then, Master-panel codes will not reach users who have a mobile number on file (users without one get the code by email).
- DKIM, SPF (MAIL FROM) and DMARC records are created by Terraform.

## 6. First release

1. In GitHub, go to Settings > Environments and create `production`, adding yourself as a required reviewer if you want to approve each release.
2. Settings > Secrets and variables > Actions > **Variables**: add each entry of `terraform output github_variables`.
3. Actions > Deploy > Run workflow. Afterwards, every push to `main` that passes CI deploys.
4. Check `https://app.banquet.ai/api/health/ready` answers `{"status":"ok","mongo":"up"}`.

## 7. Banquet.ai admin access

The platform admin token (used to approve tenants and create support staff until the admin console exists) is in Secrets Manager:

```sh
aws secretsmanager get-secret-value --secret-id "$(terraform output -raw platform_admin_token_secret)" --query SecretString --output text
```

Keep it in a password manager; do not paste it into chats or tickets.

## 8. Before the first paying hotel

- [ ] Restore drill done once (backup-and-restore.md), and the time it took noted.
- [ ] An alarm tested: stop one task in ECS and see the email arrive.
- [ ] Penetration test booked, see `docs/security-review.md`.
- [ ] Privacy policy and terms on the website; data processing terms for hotels (guest names and phone numbers are personal data under India's DPDP Act).
- [ ] GST invoice format and e-invoicing, which the billing work covers.

## Clients' own domains

`*.banquet.ai` works out of the box. A client's own domain (for example `events.hotelprime.com`) needs, per domain: an ACM certificate in `us-east-1` for CloudFront and one in `ap-south-1` for the load balancer (add the second to `custom_domain_certificate_arns`), the domain added to the CloudFront aliases, a CNAME from the client to CloudFront, and the domain marked verified for the tenant. That is manual for now. Once there are more than a handful, move to CloudFront SaaS Manager (multi-tenant distributions with managed certificates), which is built for this.

## Settings reference

The API reads these from the ECS task definition (`infra/aws/ecs.tf`) and Secrets Manager; `apps/api/.env.example` lists them all. In production the API **refuses to start** if `JWT_SECRET` or `PLATFORM_ADMIN_TOKEN` is missing, short, or a development value, if `MONGO_URL` is missing, or if `NOTIFY_PROVIDER` is not `aws`.
