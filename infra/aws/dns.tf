resource "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.domain
}

data "aws_route53_zone" "existing" {
  count = var.create_hosted_zone ? 0 : 1
  name  = var.domain
}

locals {
  zone_id = var.create_hosted_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
  # The load balancer's own name; CloudFront talks to it over HTTPS.
  origin_host = "origin.${var.domain}"
}

# Certificate for CloudFront (must be us-east-1): the root domain and every tenant sub-domain.
resource "aws_acm_certificate" "edge" {
  provider                  = aws.us_east_1
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

# Certificate for the load balancer (this region). CloudFront forwards the visitor's host name,
# so the load balancer must present a certificate for it too.
resource "aws_acm_certificate" "origin" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

# Both certificates share the same DNS validation records.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.edge.domain_validation_options : o.domain_name => {
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
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.edge.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "origin" {
  certificate_arn         = aws_acm_certificate.origin.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "apex" {
  for_each = toset(["A", "AAAA"])
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
  for_each = toset(["A", "AAAA"])
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
  zone_id = local.zone_id
  name    = local.origin_host
  type    = "A"
  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}
