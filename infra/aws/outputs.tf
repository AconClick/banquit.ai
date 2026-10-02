output "name_servers" {
  description = "Set these as the domain's name servers at the registrar."
  value       = local.has_domain && var.create_hosted_zone ? aws_route53_zone.main[0].name_servers : []
}

output "app_url" {
  description = "Where the app answers. Without a domain, users type their Domain on this login page."
  value       = "https://${local.public_host}"
}

output "atlas_allow_ip" {
  description = "Add this IP to MongoDB Atlas > Network Access (all API traffic leaves through it)."
  value       = aws_eip.nat.public_ip
}

output "mongo_url_secret" {
  description = "Paste the Atlas connection string into this secret."
  value       = aws_secretsmanager_secret.mongo_url.name
}

output "platform_admin_token_secret" {
  value = aws_secretsmanager_secret.platform_admin.name
}

output "github_variables" {
  description = "Repository variables for .github/workflows/deploy.yml (Settings > Secrets and variables > Actions > Variables)."
  value = {
    AWS_REGION          = var.region
    AWS_DEPLOY_ROLE_ARN = aws_iam_role.deploy.arn
    ECR_REPOSITORY      = aws_ecr_repository.api.name
    ECS_CLUSTER         = aws_ecs_cluster.main.name
    ECS_SERVICE         = aws_ecs_service.api.name
    ECS_TASK_FAMILY     = aws_ecs_task_definition.api.family
    WEB_BUCKET          = aws_s3_bucket.web.bucket
    CLOUDFRONT_ID       = aws_cloudfront_distribution.web.id
  }
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}
