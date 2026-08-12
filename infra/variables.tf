variable "aws_region" {
  type    = string
  default = "eu-west-1"
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["nonprod", "prod"], var.environment)
    error_message = "environment must be nonprod or prod"
  }
}
variable "name_prefix" { type = string }
variable "vpc_cidr" { type = string }
variable "availability_zones" {
  type = list(string)
  validation {
    condition     = length(var.availability_zones) >= 1
    error_message = "at least one AZ is required"
  }
}
variable "container_image_digest" {
  type = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.container_image_digest)) && var.container_image_digest != "sha256:${join("", [for _ in range(64) : "0"])}"
    error_message = "use an immutable image digest"
  }
}
variable "domain_name" {
  type    = string
  default = null
}
variable "certificate_arn" {
  type    = string
  default = null
  validation {
    condition     = var.certificate_arn != null && can(regex("^arn:aws:acm:eu-west-1:[0-9]{12}:certificate/[0-9a-f-]{36}$", var.certificate_arn))
    error_message = "an explicit eu-west-1 ACM certificate ARN is required"
  }
}
variable "cloudfront_certificate_arn" {
  type    = string
  default = null
  validation {
    condition     = var.cloudfront_certificate_arn == null || can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]{36}$", var.cloudfront_certificate_arn))
    error_message = "CloudFront certificate must be an explicit us-east-1 ACM ARN"
  }
}
variable "desired_count" {
  type    = number
  default = 1
}
variable "min_capacity" {
  type    = number
  default = 1
}
variable "max_capacity" {
  type    = number
  default = 4
}
variable "monthly_budget_usd" {
  type    = number
  default = 0
  validation {
    condition     = var.monthly_budget_usd >= 0
    error_message = "monthly_budget_usd must be zero (disabled) or positive"
  }
}
variable "budget_notification_emails" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for email in var.budget_notification_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", email))])
    error_message = "budget notification emails must be valid explicit addresses"
  }
}
variable "enable_cognito" {
  type    = bool
  default = true
}
variable "user_pool_domain_prefix" {
  type    = string
  default = null
}
variable "enable_cloudfront" {
  type    = bool
  default = false
}
variable "github_owner" {
  type    = string
  default = "abdalrahmanattya"
}
variable "github_repository" {
  type    = string
  default = "legacy-application-modernization"
}
variable "tags" {
  type    = map(string)
  default = {}
}
