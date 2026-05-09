locals {
  # The 5 secrets the app needs at runtime. Created empty here; populated
  # out-of-band so values never enter terraform state.
  #
  #   auth-secret         AUTH_SECRET (Auth.js cookie/JWT signing)
  #   auth-github-id      AUTH_GITHUB_ID (GitHub OAuth App client id)
  #   auth-github-secret  AUTH_GITHUB_SECRET (GitHub OAuth App client secret)
  #   anthropic-key       ANTHROPIC_API_KEY (only when REVIEW_EXECUTOR=claude)
  #   postgres-password   POSTGRES_PASSWORD (postgres sidecar boots with this)
  #
  # Phase C requires postgres-password populated before commit 8 applies.
  # The other four can stay empty until Phase D's first real image deploy
  # (the http-echo placeholder doesn't read them).
  secret_names = [
    "auth-secret",
    "auth-github-id",
    "auth-github-secret",
    "anthropic-key",
    "postgres-password",
  ]
}

resource "aws_secretsmanager_secret" "app" {
  for_each = toset(local.secret_names)
  name     = "${var.app_name}/${each.key}"

  # Recovery window is the AWS default (30 days) — fine for POC.
  # If a secret needs to be re-created with the same name, use
  # `aws secretsmanager delete-secret --force-delete-without-recovery`
  # before re-applying.
}
