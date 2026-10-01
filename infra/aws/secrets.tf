# Values the API reads at start. JWT and platform tokens are generated here; the MongoDB Atlas
# connection string is pasted in once by hand (see docs/ops/go-live.md) so it never sits in code.

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "platform_admin" {
  length  = 48
  special = false
}

resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name = "${local.name}/jwt-secret"
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "platform_admin" {
  name = "${local.name}/platform-admin-token"
}

resource "aws_secretsmanager_secret_version" "platform_admin" {
  secret_id     = aws_secretsmanager_secret.platform_admin.id
  secret_string = random_password.platform_admin.result
}

resource "aws_secretsmanager_secret" "mongo_url" {
  name        = "${local.name}/mongo-url"
  description = "MongoDB Atlas connection string. Set with: aws secretsmanager put-secret-value --secret-id <name> --secret-string '<uri>'"
}
