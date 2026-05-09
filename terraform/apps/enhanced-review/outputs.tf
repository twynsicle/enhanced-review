# Outputs are added in subsequent commits as their resources land.
# Commit 8 — ECS service, task definition, ALB target, Route 53, app URL.

# --- Commit 7: IAM, secrets, EFS, log group ---

output "github_image_deploy_role_arn" {
  description = "ARN of the role assumed by GitHub Actions image-deploy workflow (Phase D). Trust scoped to repo:<github_owner>/<github_repo>."
  value       = aws_iam_role.github_image_deploy.arn
}

output "ecr_repository_url" {
  description = "ECR repo URL for this app (re-exported from platform for convenience). Phase D's workflow tags + pushes to this URL."
  value       = local.platform.ecr_repository_urls[var.app_name]
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for this app. Use with `aws logs tail`."
  value       = aws_cloudwatch_log_group.app.name
}

output "secret_arns" {
  description = "Map of secret short-name → Secrets Manager ARN. Useful for `aws secretsmanager put-secret-value --secret-id <arn>`."
  value       = { for k, v in aws_secretsmanager_secret.app : k => v.arn }
}

output "app_url" {
  description = "Public URL the app serves at after Cognito gating."
  value       = local.app_url
}
