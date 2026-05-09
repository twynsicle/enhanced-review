# GitHub Actions OIDC federation. One provider per AWS account; all app
# modules' deploy roles trust this. Trust scope (which repo, which branch)
# is enforced in each role's assume-role policy, not here.
#
# AWS validates GitHub OIDC tokens via the well-known JWKS endpoint;
# `thumbprint_list` is essentially a placeholder now (the original 2021
# thumbprint is provided for the static check, but AWS will accept any
# valid GitHub OIDC token regardless).
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
