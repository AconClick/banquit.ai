# Email through SES. With a domain: from no-reply@<domain>, signed with DKIM, with SPF and DMARC.
# Without one: from var.mail_from, which SES verifies by emailing it a link. New SES accounts start
# in the sandbox; ask AWS for production access before go-live (docs/ops/go-live.md).

locals {
  mail_from = local.has_domain ? "no-reply@${var.domain}" : var.mail_from
}

check "mail_from_without_domain" {
  assert {
    condition     = local.has_domain || var.mail_from != ""
    error_message = "Set mail_from (an address you can open) while there is no domain."
  }
}

resource "aws_sesv2_email_identity" "address" {
  count          = local.has_domain ? 0 : 1
  email_identity = var.mail_from
}

resource "aws_sesv2_email_identity" "domain" {
  count          = local.has_domain ? 1 : 0
  email_identity = var.domain
}

resource "aws_route53_record" "dkim" {
  count   = local.has_domain ? 3 : 0
  zone_id = local.zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count                  = local.has_domain ? 1 : 0
  email_identity         = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain       = "${var.mail_from_subdomain}.${var.domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  count   = local.has_domain ? 1 : 0
  zone_id = local.zone_id
  name    = "${var.mail_from_subdomain}.${var.domain}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count   = local.has_domain ? 1 : 0
  zone_id = local.zone_id
  name    = "${var.mail_from_subdomain}.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.has_domain ? 1 : 0
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=DMARC1; p=quarantine; rua=mailto:${var.alert_email}"]
}

# SMS for the Master-panel code. India needs a registered sender id and DLT template before SMS
# is delivered; set those up in the SNS console (docs/ops/go-live.md).
resource "aws_sns_sms_preferences" "sms" {
  default_sms_type    = "Transactional"
  monthly_spend_limit = 100
}
