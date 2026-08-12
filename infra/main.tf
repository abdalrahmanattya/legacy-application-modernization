locals {
  prod           = var.environment == "prod"
  az_count       = local.prod ? 2 : 1
  private_cidrs  = [for i in range(local.az_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  isolated_cidrs = [for i in range(local.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 4)]
}
module "cognito" {
  source      = "./modules/cognito"
  name_prefix = var.name_prefix
  tags        = var.tags
}
module "network" {
  source             = "./modules/network"
  name_prefix        = var.name_prefix
  vpc_cidr           = var.vpc_cidr
  availability_zones = slice(var.availability_zones, 0, local.az_count)
  private_cidrs      = local.private_cidrs
  isolated_cidrs     = local.isolated_cidrs
  tags               = var.tags
}
module "data" {
  source                 = "./modules/data"
  name_prefix            = var.name_prefix
  subnet_ids             = module.network.isolated_subnet_ids
  multi_az               = local.prod
  vpc_id                 = module.network.vpc_id
  task_security_group_id = module.delivery.task_security_group_id
  tags                   = var.tags
}
module "delivery" {
  source                     = "./modules/delivery"
  name_prefix                = var.name_prefix
  image_digest               = var.container_image_digest
  private_subnet_ids         = module.network.private_subnet_ids
  isolated_subnet_ids        = module.network.isolated_subnet_ids
  vpc_id                     = module.network.vpc_id
  endpoint_security_group_id = module.network.endpoint_security_group_id
  certificate_arn            = var.certificate_arn
  environment                = var.environment
  desired_count              = var.desired_count
  min_capacity               = var.min_capacity
  max_capacity               = var.max_capacity
  monthly_budget_usd         = var.monthly_budget_usd
  budget_notification_emails = var.budget_notification_emails
  cognito_user_pool_id       = module.cognito.user_pool_id
  cognito_client_id          = module.cognito.client_id
  cognito_issuer_url         = module.cognito.issuer_url
  tags                       = var.tags
}
module "edge" {
  source          = "./modules/edge"
  enabled         = var.enable_cloudfront
  domain_name     = var.domain_name
  certificate_arn = var.cloudfront_certificate_arn
  origin_arn      = module.delivery.alb_arn
  origin_dns_name = module.delivery.alb_dns_name
  tags            = var.tags
}
