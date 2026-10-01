# Alarms email var.alert_email through one SNS topic.

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudFront and Route 53 health check metrics are in us-east-1, so alarms there need their own topic.
resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email_us_east_1" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# The API logs JSON lines; count the error ones.
resource "aws_cloudwatch_log_metric_filter" "api_errors" {
  name           = "${local.name}-api-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.level = \"error\" }"
  metric_transformation {
    name      = "ApiErrorLogs"
    namespace = "BanquetAI"
    value     = "1"
    unit      = "Count"
  }
}

locals {
  alb_dimensions = { LoadBalancer = aws_lb.api.arn_suffix }
  tg_dimensions  = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  alarms = {
    api-error-logs = {
      namespace = "BanquetAI", metric = "ApiErrorLogs", stat = "Sum", threshold = 5, periods = 1, dims = {}
      text      = "The API logged 5 or more errors in 5 minutes."
    }
    api-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 10, periods = 1, dims = local.tg_dimensions
      text      = "The API answered 10 or more requests with a server error in 5 minutes."
    }
    api-unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 1, periods = 2, dims = local.tg_dimensions
      text      = "An API container failed its health check (database unreachable or the process is stuck)."
    }
    api-slow = {
      namespace = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "p95", threshold = 2, periods = 3, dims = local.tg_dimensions
      text      = "95% of API requests took longer than 2 seconds for 15 minutes."
    }
    api-cpu = {
      namespace = "AWS/ECS", metric = "CPUUtilization", stat = "Average", threshold = 85, periods = 3, dims = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.api.name }
      text      = "API containers have used over 85% CPU for 15 minutes even after scaling."
    }
    api-memory = {
      namespace = "AWS/ECS", metric = "MemoryUtilization", stat = "Average", threshold = 85, periods = 3, dims = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.api.name }
      text      = "API containers have used over 85% memory for 15 minutes."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "api" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.text
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  statistic           = contains(["Sum", "Average", "Maximum", "Minimum", "SampleCount"], each.value.stat) ? each.value.stat : null
  extended_statistic  = contains(["Sum", "Average", "Maximum", "Minimum", "SampleCount"], each.value.stat) ? null : each.value.stat
  period              = 300
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Outside-in check: is the site answering, through CloudFront, with a working database?
resource "aws_route53_health_check" "site" {
  fqdn              = "app.${var.domain}"
  type              = "HTTPS"
  port              = 443
  resource_path     = "/api/health/ready"
  request_interval  = 30
  failure_threshold = 3
  regions           = ["ap-southeast-1", "eu-west-1", "us-east-1"]
}

resource "aws_cloudwatch_metric_alarm" "site_down" {
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-site-down"
  alarm_description   = "app.${var.domain}/api/health/ready is failing from outside AWS."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.site.id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
  ok_actions          = [aws_sns_topic.alerts_us_east_1.arn]
}

resource "aws_cloudwatch_metric_alarm" "edge_5xx" {
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-edge-5xx"
  alarm_description   = "More than 5% of all requests failed with a server error at CloudFront."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  dimensions          = { DistributionId = aws_cloudfront_distribution.web.id, Region = "Global" }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
}
