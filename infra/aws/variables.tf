variable "env" {
  description = "Environment name, used in resource names."
  type        = string
  default     = "prod"
}

variable "region" {
  description = "Main AWS region (Mumbai is closest to the first customers)."
  type        = string
  default     = "ap-south-1"
}

variable "domain" {
  description = "Root domain. Tenants get <subdomain>.<domain>; the common login is app.<domain>. Empty: no domain yet, everyone uses the CloudFront address and types their Domain at login."
  type        = string
  default     = ""
}

variable "mail_from" {
  description = "Sender address when there is no domain yet (SES emails it a verification link). Ignored once domain is set: mail then comes from no-reply@<domain>."
  type        = string
  default     = ""
}

variable "create_hosted_zone" {
  description = "Create the Route 53 hosted zone. Set false if the zone already exists in this account."
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Where alarms are emailed (confirm the subscription email AWS sends)."
  type        = string
}

variable "github_repository" {
  description = "owner/repo allowed to deploy through GitHub Actions."
  type        = string
  default     = "AconClick/banquit.ai"
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_min_tasks" {
  description = "Never fewer than 2, so one can fail or be replaced without downtime."
  type        = number
  default     = 2
}

variable "api_max_tasks" {
  type    = number
  default = 6
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes from one IP before WAF blocks it. Hotels share IPs, so keep it generous."
  type        = number
  default     = 5000
}

variable "mail_from_subdomain" {
  description = "Sub-domain used as the SES MAIL FROM domain (bounce handling)."
  type        = string
  default     = "mail"
}

variable "custom_domain_certificate_arns" {
  description = "Extra ACM certificates (this region) for tenants' own domains, added to the load balancer."
  type        = list(string)
  default     = []
}
