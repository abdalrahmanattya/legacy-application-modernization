variable "enabled" {
  type    = bool
  default = false
}
variable "domain_name" {
  type    = string
  default = null
}
variable "certificate_arn" {
  type    = string
  default = null
}
variable "origin_arn" { type = string }
variable "origin_dns_name" { type = string }
variable "tags" { type = map(string) }

resource "aws_cloudfront_vpc_origin" "alb" {
  count = var.enabled ? 1 : 0
  vpc_origin_endpoint_config {
    name                   = "private-alb"
    arn                    = var.origin_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"
    origin_ssl_protocols {
      quantity = 1
      items    = ["TLSv1.2"]
    }
  }
  tags = var.tags
}

resource "aws_cloudfront_distribution" "this" {
  count   = var.enabled ? 1 : 0
  enabled = true
  comment = "Private ALB edge for ${var.domain_name == null ? "internal" : var.domain_name}"
  aliases = var.domain_name == null ? [] : [var.domain_name]
  origin {
    domain_name = var.origin_dns_name
    origin_id   = "private-alb"
    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.alb[0].id
    }
  }
  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "private-alb"
    viewer_protocol_policy = "redirect-to-https"
    forwarded_values {
      query_string = true
      cookies { forward = "all" }
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = var.domain_name == null
    acm_certificate_arn            = var.domain_name == null ? null : var.certificate_arn
    ssl_support_method             = var.domain_name == null ? null : "sni-only"
    minimum_protocol_version       = "TLSv1.2_2021"
  }
  tags = var.tags
  lifecycle {
    precondition {
      condition     = !var.enabled || var.domain_name == null || (var.certificate_arn != null && can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]{36}$", var.certificate_arn)))
      error_message = "An explicit us-east-1 certificate ARN is required when a CloudFront domain is configured"
    }
  }
}

output "distribution_domain_name" { value = try(aws_cloudfront_distribution.this[0].domain_name, null) }
