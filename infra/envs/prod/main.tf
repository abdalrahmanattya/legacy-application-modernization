module "stack" {
  source                 = "../../"
  aws_region             = "eu-west-1"
  environment            = "prod"
  name_prefix            = "order-reference-prod"
  vpc_cidr               = "10.43.0.0/16"
  availability_zones     = ["eu-west-1a", "eu-west-1b"]
  container_image_digest = var.container_image_digest
  certificate_arn        = var.certificate_arn
  desired_count          = 2
  min_capacity           = 2
  max_capacity           = 6
  tags                   = var.tags
}
variable "container_image_digest" { type = string }
variable "tags" { type = map(string) }
variable "certificate_arn" {
  type    = string
  default = null
}
