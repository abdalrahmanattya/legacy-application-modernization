variable "github_owner" { type = string }
variable "github_repository" { type = string }
variable "apply_environment" {
  type    = string
  default = "production"
}
variable "tags" { type = map(string) }
variable "enable_cognito" {
  type    = bool
  default = true
}
variable "user_pool_domain_prefix" {
  type    = string
  default = null
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
locals {
  subject      = "repo:${var.github_owner}/${var.github_repository}:ref:refs/heads/main"
  plan_subject = "repo:${var.github_owner}/${var.github_repository}:pull_request"
  trust        = { Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Federated = aws_iam_openid_connect_provider.github.arn }, Action = "sts:AssumeRoleWithWebIdentity", Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }, StringLike = { "token.actions.githubusercontent.com:sub" = [local.subject, local.plan_subject] } } }] }
}
resource "aws_iam_role" "plan" {
  name               = "${var.github_repository}-plan"
  assume_role_policy = jsonencode(local.trust)
  tags               = var.tags
}
resource "aws_iam_role_policy" "plan" {
  role   = aws_iam_role.plan.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["ec2:DescribeAvailabilityZones", "ec2:DescribeVpcs", "ec2:DescribeSubnets", "ec2:DescribeRouteTables", "ec2:DescribeSecurityGroups", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeTargetGroups", "rds:DescribeDBInstances", "rds:DescribeDBSubnetGroups", "ecs:DescribeClusters", "ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecr:DescribeRepositories", "ecr:DescribeImages", "s3:ListAllMyBuckets", "iam:GetRole", "iam:ListRoles"], Resource = "*" }] })
}
resource "aws_iam_role" "apply" {
  name               = "${var.github_repository}-apply"
  assume_role_policy = jsonencode(merge(local.trust, { Statement = [merge(local.trust.Statement[0], { Condition = merge(local.trust.Statement[0].Condition, { StringLike = { "token.actions.githubusercontent.com:sub" = local.subject, "token.actions.githubusercontent.com:environment" = var.apply_environment } }) })] }))
  tags               = var.tags
}
resource "aws_iam_role_policy" "apply" {
  role   = aws_iam_role.apply.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["cloudformation:DescribeStacks", "ecs:DescribeClusters", "ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:UpdateService", "ecs:UpdateServicePrimaryTaskSet", "ecr:DescribeRepositories", "ecr:DescribeImages", "iam:PassRole", "logs:DescribeLogGroups", "rds:DescribeDBInstances", "secretsmanager:DescribeSecret"], Resource = "*" }] })
}
output "plan_role_arn" { value = aws_iam_role.plan.arn }
output "apply_role_arn" { value = aws_iam_role.apply.arn }

resource "aws_cognito_user_pool" "users" {
  count                    = var.enable_cognito ? 1 : 0
  name                     = "${var.github_repository}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 1
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  user_pool_add_ons { advanced_security_mode = "ENFORCED" }
  tags = var.tags
}

resource "aws_cognito_resource_server" "api" {
  count        = var.enable_cognito ? 1 : 0
  identifier   = "https://${var.github_repository}/api"
  name         = "${var.github_repository}-api"
  user_pool_id = aws_cognito_user_pool.users[0].id
  scope {
    scope_name        = "orders.read"
    scope_description = "Read orders and reports"
  }
  scope {
    scope_name        = "orders.write"
    scope_description = "Create and transition orders"
  }
}

resource "aws_cognito_user_pool_client" "public" {
  count                                = var.enable_cognito ? 1 : 0
  name                                 = "${var.github_repository}-public"
  user_pool_id                         = aws_cognito_user_pool.users[0].id
  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  allowed_oauth_flows_user_pool_client = false
}

resource "aws_cognito_user_pool_domain" "this" {
  count        = var.enable_cognito && var.user_pool_domain_prefix != null ? 1 : 0
  domain       = var.user_pool_domain_prefix
  user_pool_id = aws_cognito_user_pool.users[0].id
}

output "user_pool_id" { value = try(aws_cognito_user_pool.users[0].id, null) }
output "user_pool_arn" { value = try(aws_cognito_user_pool.users[0].arn, null) }
output "client_id" { value = try(aws_cognito_user_pool_client.public[0].id, null) }
output "resource_server_identifier" { value = try(aws_cognito_resource_server.api[0].identifier, null) }
