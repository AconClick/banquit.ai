terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Keep state in an encrypted S3 bucket (it holds generated secrets). Create the bucket once by
  # hand, then uncomment and run `terraform init -migrate-state`. See docs/ops/go-live.md.
  # backend "s3" {
  #   bucket       = "banquetai-terraform-state"
  #   key          = "prod/terraform.tfstate"
  #   region       = "ap-south-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region
  default_tags { tags = { app = "banquetai", env = var.env } }
}

# CloudFront certificates, WAF and CloudFront metrics live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = { app = "banquetai", env = var.env } }
}
