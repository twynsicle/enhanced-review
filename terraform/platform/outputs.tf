# Outputs are added in subsequent commits as their resources land.
# Commit 3 — ECS cluster + ECR + OIDC outputs.
# Commit 4 — Route 53 zone outputs.
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
