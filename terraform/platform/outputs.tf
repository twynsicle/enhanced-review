# Outputs are added in subsequent commits as their resources land.
# Commit 5 — ACM cert outputs.
# Commit 6 — ALB + Cognito outputs.

# --- VPC (commit 2) ---

output "vpc_id" {
  description = "Platform VPC ID. App module reads this for ALB target groups, ECS network configuration, and security groups."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (2 AZs). App module spreads ECS tasks across these and uses both for the EFS mount targets."
  value       = [for s in aws_subnet.public : s.id]
}

output "availability_zones" {
  description = "Availability zone names corresponding to public_subnet_ids (same order)."
  value       = local.azs
}

# --- ECS cluster + ECR + OIDC (commit 3) ---

output "ecs_cluster_id" {
  description = "ECS cluster ID. App module's aws_ecs_service uses this."
  value       = aws_ecs_cluster.main.id
}

output "ecs_cluster_name" {
  description = "ECS cluster name (used by ops commands like aws ecs execute-command)."
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.main.arn
}

output "ecr_repository_urls" {
  description = "Map of registered app name to ECR repository URL (e.g. \"123456789012.dkr.ecr.us-west-2.amazonaws.com/enhanced-review\"). App module looks up its own repo by app_name."
  value       = { for k, v in aws_ecr_repository.app : k => v.repository_url }
}

output "ecr_repository_arns" {
  description = "Map of registered app name to ECR repository ARN. Used by app's IAM policies (deploy role's ECR push permissions, task execution role's ECR pull permissions)."
  value       = { for k, v in aws_ecr_repository.app : k => v.arn }
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider. App module's deploy roles trust this."
  value       = aws_iam_openid_connect_provider.github.arn
}

# --- Route 53 (commit 4) ---

output "route53_zone_id" {
  description = "Route 53 hosted zone ID for var.domain_name. App module creates ALIAS records (subdomain → ALB) under this zone."
  value       = aws_route53_zone.main.zone_id
}

output "route53_name_servers" {
  description = "AWS NS records for the hosted zone. If the domain is registered outside Route 53, the user must update their registrar's NS records to these values before commit 5 (ACM cert validation) can succeed."
  value       = aws_route53_zone.main.name_servers
}

output "domain_name" {
  description = "Parent domain. Mirrors var.domain_name; exposed as an output so the app module can compose its subdomain URL without re-declaring the variable."
  value       = var.domain_name
}
