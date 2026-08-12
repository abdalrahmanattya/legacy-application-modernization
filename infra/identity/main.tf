terraform {
  required_version = "1.15.8"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 6.0" } }
}
provider "aws" { region = "eu-west-1" }
module "github" {
  source            = "../modules/identity"
  github_owner      = var.github_owner
  github_repository = var.github_repository
  tags              = { Project = "legacy-application-modernization", ManagedBy = "terraform" }
}
variable "github_owner" { type = string }
variable "github_repository" { type = string }
