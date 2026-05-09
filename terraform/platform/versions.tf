terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Partial backend config — bucket / key / region / dynamodb_table / encrypt
  # are supplied via -backend-config flags at `terraform init`. See
  # terraform/README.md.
  backend "s3" {}
}

provider "aws" {
  region = var.region
}
