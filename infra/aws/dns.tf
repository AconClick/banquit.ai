# Everything in this file exists only once a domain is set (var.domain).

resource "aws_route53_zone" "main" {
  count = local.has_domain && var.create_hosted_zone ? 1 : 0
  name  = var.domain
}

data "aws_route53_zone" "existing" {
  count = local.has_domain && !var.create_hosted_zone ? 1 : 0
  name  = var.domain
}

locals {
  has_domain = var.domain != ""
  zone_id    = !local.has_domain ? "" : var.create_hosted_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
  # How CloudFront reaches the load balancer: by its own name over HTTPS once there is a domain,
  # else by the load balancer's AWS name over HTTP (still only from CloudFront, with the secret header).
  origin_host = local.has_domain ? "origin.${var.domain}" : aws_lb.api.dns_name
  # The address people use: app.<domain>, or the CloudFront default address until a domain is bought.
  public_host = local.has_domain ? "app.${var.domain}" : aws_cloudfront_distribution.web.domain_name
}

# Certificate for CloudFront (must be us-east-1): the root domain and every tenant sub-domain.
resource "aws_acm_certificate" "edge" {
  count                     = local.has_domain ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

# Certificate for the load balancer (this region). CloudFront forwards the visitor's host name,
# so the load balancer must present a certificate for it too.
resource "aws_acm_certificate" "origin" {
  count                     = local.has_domain ? 1 : 0
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

# Both certificates share the same DNS validation records.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in(local.has_domain ? aws_acm_certificate.edge[0].domain_validation_options : []) : o.domain_name => {
      name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value
    }
  }
  zone_id         = local.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "edge" {
  count                   = local.has_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.edge[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "origin" {
  count                   = local.has_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.origin[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "apex" {
  for_each = local.has_domain ? toset(["A", "AAAA"]) : toset([])
  zone_id  = local.zone_id
  name     = var.domain
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

# Every tenant sub-domain (prime.banquet.ai, app.banquet.ai, ...) goes to the same CloudFront.
resource "aws_route53_record" "wildcard" {
  for_each = local.has_domain ? toset(["A", "AAAA"]) : toset([])
  zone_id  = local.zone_id
  name     = "*.${var.domain}"
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "origin" {
  count   = local.has_domain ? 1 : 0
  zone_id = local.zone_id
  name    = local.origin_host
  type    = "A"
  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}
