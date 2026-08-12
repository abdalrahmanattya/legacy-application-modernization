module "stack" {
  source                 = "../../"
  aws_region             = "eu-west-1"
  environment            = "nonprod"
  name_prefix            = "order-reference-nonprod"
  vpc_cidr               = "10.42.0.0/16"
  availability_zones     = ["eu-west-1a"]
  container_image_digest = var.container_image_digest
  certificate_arn        = var.certificate_arn
  desired_count          = 1
  min_capacity           = 1
  max_capacity           = 2
  tags                   = var.tags
}
variable "container_image_digest" { type = string }
variable "tags" { type = map(string) }
variable "certificate_arn" {
  type    = string
  default = null
}
