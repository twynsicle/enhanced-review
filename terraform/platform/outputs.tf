# All platform outputs land by commit 6; this file is the stable interface
# the application module consumes via terraform_remote_state.

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

# --- ACM (commit 5) ---

output "acm_certificate_arn" {
  description = "Validated wildcard ACM cert ARN (*.<domain> + apex SAN). Platform's ALB listener uses this; app module doesn't need to read it directly because the listener already terminates TLS."
  value       = aws_acm_certificate_validation.wildcard.certificate_arn
}

# --- ALB + Cognito (commit 6) ---

output "alb_arn" {
  description = "Platform ALB ARN."
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "Platform ALB DNS name. App module's Route 53 ALIAS record points here."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Platform ALB hosted-zone ID (used by Route 53 ALIAS records, not the same as the Route 53 zone the app's record lives in)."
  value       = aws_lb.main.zone_id
}

output "alb_listener_https_arn" {
  description = "Platform ALB HTTPS listener ARN. App module attaches its listener rule here."
  value       = aws_lb_listener.https.arn
}

output "alb_security_group_id" {
  description = "Platform ALB security group ID. App module's task SG ingress allows :3000 from this SG only."
  value       = aws_security_group.alb.id
}

output "cognito_user_pool_id" {
  description = "Shared Cognito user pool ID. App module creates a user pool client (per-app) inside this pool."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_arn" {
  description = "Shared Cognito user pool ARN. Listener rule's authenticate-cognito action references this."
  value       = aws_cognito_user_pool.main.arn
}

output "cognito_user_pool_domain" {
  description = "Cognito hosted UI domain prefix (e.g. \"platform-abc12345\"). Listener rule's authenticate-cognito action references this."
  value       = aws_cognito_user_pool_domain.main.domain
}
