# All app outputs land by commit 8.

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

# --- Commit 8: task definition, service, ALB target, Cognito client, Route 53 ---

output "ecs_service_arn" {
  description = "ECS service ARN. Used by `aws ecs update-service ...`."
  value       = aws_ecs_service.app.id
}

output "ecs_service_name" {
  description = "ECS service name (matches var.app_name). Used by `aws ecs execute-command`."
  value       = aws_ecs_service.app.name
}

output "ecs_task_definition_family" {
  description = "Task definition family. Phase D's image-deploy pipeline registers new revisions of this family."
  value       = aws_ecs_task_definition.app.family
}

output "alb_target_group_arn" {
  description = "ALB target group ARN. Phase D's image-deploy pipeline references this when forcing a deployment."
  value       = aws_lb_target_group.web.arn
}

output "cognito_user_pool_client_id" {
  description = "App-specific Cognito user pool client ID. Useful for debugging ALB authenticate-cognito flow."
  value       = aws_cognito_user_pool_client.alb.id
}
