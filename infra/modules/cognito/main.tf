variable "name_prefix" { type = string }
variable "tags" { type = map(string) }

resource "aws_cognito_user_pool" "users" {
  name                     = "${var.name_prefix}-users"
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
  identifier   = "https://${var.name_prefix}/api"
  name         = "${var.name_prefix}-api"
  user_pool_id = aws_cognito_user_pool.users.id
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
  name                                 = "${var.name_prefix}-public"
  user_pool_id                         = aws_cognito_user_pool.users.id
  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  allowed_oauth_flows_user_pool_client = false
}
output "user_pool_id" { value = aws_cognito_user_pool.users.id }
output "client_id" { value = aws_cognito_user_pool_client.public.id }
output "issuer_url" { value = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.users.id}" }
data "aws_region" "current" {}
