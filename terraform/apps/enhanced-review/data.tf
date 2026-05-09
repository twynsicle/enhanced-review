data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket         = var.platform_state_bucket
    key            = "platform/terraform.tfstate"
    region         = var.region
    dynamodb_table = var.platform_state_lock_table
    encrypt        = true
  }
}

data "aws_caller_identity" "current" {}

locals {
  platform = data.terraform_remote_state.platform.outputs

  # Computed once because every resource that needs the app's URL uses it
  # (Cognito client callback, env vars, Route 53 record name).
  app_url = "https://${var.subdomain}.${local.platform.domain_name}"
}
