# Off-site copy of MongoDB Atlas backups. Atlas Cloud Backup (continuous, point-in-time) is the
# main backup; Atlas can also export snapshots to this bucket, in our own AWS account, so a copy
# survives even if the Atlas project is lost. Fill the two variables from Atlas
# (Project > Integrations > AWS IAM Role Access) and apply again. See docs/ops/backup-and-restore.md.

variable "atlas_aws_account_arn" {
  description = "Atlas's AWS principal ARN shown when you authorise an IAM role in Atlas. Empty: skip the export bucket role."
  type        = string
  default     = ""
}

variable "atlas_external_id" {
  description = "External id Atlas shows next to its AWS principal."
  type        = string
  default     = ""
}

resource "aws_s3_bucket" "backups" {
  bucket = "${local.name}-db-backups-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Keep 35 days in S3 Standard, then move to Glacier; delete after 400 days (13 months covers a
# financial year plus a month).
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "age-out"
    status = "Enabled"
    filter {}
    transition {
      days          = 35
      storage_class = "GLACIER_IR"
    }
    expiration { days = 400 }
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

resource "aws_iam_role" "atlas_export" {
  count = var.atlas_aws_account_arn == "" ? 0 : 1
  name  = "${local.name}-atlas-snapshot-export"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = var.atlas_aws_account_arn }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "sts:ExternalId" = var.atlas_external_id } }
    }]
  })
}

resource "aws_iam_role_policy" "atlas_export" {
  count = var.atlas_aws_account_arn == "" ? 0 : 1
  role  = aws_iam_role.atlas_export[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetBucketLocation", "s3:ListBucket"], Resource = aws_s3_bucket.backups.arn },
      { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject"], Resource = "${aws_s3_bucket.backups.arn}/*" },
    ]
  })
}
