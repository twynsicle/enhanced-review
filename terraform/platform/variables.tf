variable "region" {
  description = "AWS region for all platform resources."
  type        = string
  default     = "us-west-2"
}

variable "registered_apps" {
  description = "Apps that need ECR repositories provisioned by the platform module. Adding a new app to the platform = a commit here. ECR is platform-owned (not app-owned) so the repo exists before the app's ECS service tries to pull, breaking the chicken-and-egg cycle."
  type        = list(string)
  default     = ["enhanced-review"]
}
