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

variable "domain_name" {
  description = "Parent domain (e.g. example.com). Apps live at <subdomain>.<domain_name>. Wildcard ACM cert covers *.<domain_name> + apex SAN. Domain must either be registered in Route 53 or have its NS records updated to point at this zone after commit 4 applies."
  type        = string
}

variable "github_owner" {
  description = "GitHub owner/org used in the OIDC trust policies for the shared `enhanced-review-github-tf` deploy role. Restricts which repo can assume the role."
  type        = string
  default     = "twynsicle"
}

variable "github_repo" {
  description = "GitHub repo name used in the OIDC trust policies for the shared `enhanced-review-github-tf` deploy role. Combined with github_owner to form the `repo:<owner>/<repo>` sub claim."
  type        = string
  default     = "enhanced-review"
}
