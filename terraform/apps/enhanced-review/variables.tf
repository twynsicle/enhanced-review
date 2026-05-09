variable "region" {
  description = "AWS region. Must match the platform module's region."
  type        = string
  default     = "us-west-2"
}

variable "platform_state_bucket" {
  description = "S3 bucket holding the platform module's tfstate. Set this from `bootstrap.sh` output (enhanced-review-tfstate-<account-id>)."
  type        = string
}

variable "platform_state_lock_table" {
  description = "DynamoDB lock table used by both modules' state backends."
  type        = string
  default     = "enhanced-review-tflock"
}

# App identity. Defaults match this repo; a fork would override these.
variable "app_name" {
  description = "Name used for ECR repo lookup, ECS service, log group, secret prefix, IAM role names."
  type        = string
  default     = "enhanced-review"
}

variable "subdomain" {
  description = "Subdomain under the platform's domain_name (e.g. \"enhanced-review\" → enhanced-review.example.com)."
  type        = string
  default     = "enhanced-review"
}

variable "github_owner" {
  description = "GitHub owner/org used in the OIDC trust policy for the deploy role."
  type        = string
  default     = "twynsicle"
}

variable "github_repo" {
  description = "GitHub repo name used in the OIDC trust policy for the deploy role."
  type        = string
  default     = "enhanced-review"
}

# Web image. Default is the Phase C placeholder; Phase D's first image deploy
# overrides this with the ECR URI + SHA tag.
variable "web_image" {
  description = "Container image for the `web` container. Default is a public placeholder that satisfies the ALB health check on /api/health."
  type        = string
  default     = "public.ecr.aws/hashicorp/http-echo:0.2.3"
}

variable "web_image_command" {
  description = "Command override for the web container. Required for the placeholder image; ignored once Phase D sets a real image."
  type        = list(string)
  default     = ["-listen=:3000", "-text=enhanced-review placeholder"]
}

variable "desired_count" {
  description = "ECS service desired_count. Default 1; set to 0 to pause the app without destroying state."
  type        = number
  default     = 1
}

variable "cpu" {
  description = "Task CPU in vCPU units (e.g. \"512\" = 0.5 vCPU)."
  type        = string
  default     = "512"
}

variable "memory" {
  description = "Task memory in MiB."
  type        = string
  default     = "1024"
}
