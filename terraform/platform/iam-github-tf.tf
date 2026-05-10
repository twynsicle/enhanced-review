# Shared IAM role assumed by the GitHub Actions Terraform-deploy workflow
# (`.github/workflows/deploy-infra.yml`) via OIDC. One role, used to apply
# both the platform module and every app module. Single-tenant POC scope:
# broad permissions, scoped by name prefix where AWS allows.
#
# Bootstrap: this role is self-managed by Terraform but needs to exist
# before any pipeline can assume it. Maintainer applies the platform module
# locally once after adding this file. Subsequent applies happen via the
# pipeline using this role.

data "aws_iam_policy_document" "github_tf_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # `sub` claim restricts the role to this repo, on main-branch pushes
    # or pull-request runs. A fork or unrelated repo can mint a GitHub
    # OIDC token but won't satisfy this condition.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_owner}/${var.github_repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_tf" {
  name               = "enhanced-review-github-tf"
  assume_role_policy = data.aws_iam_policy_document.github_tf_trust.json
}

# Permissions: organized by AWS service, scoped by name prefix where the
# action supports it. Many AWS services don't allow resource-level
# conditions on Describe* / List* (e.g. ec2:DescribeVpcs returns all VPCs
# regardless of resource ARN), so those are necessarily "*" — TF reads
# everything during plan even if it only manages a subset.
data "aws_iam_policy_document" "github_tf" {
  # --- EC2 / VPC ---
  # Describe + Get are read-only and AWS doesn't reliably support
  # resource-level scoping; mutate actions create/destroy resources whose
  # ARNs aren't known until creation.
  statement {
    sid = "Ec2ReadAll"
    actions = [
      "ec2:Describe*",
      "ec2:Get*",
    ]
    resources = ["*"]
  }
  statement {
    sid = "Ec2Manage"
    actions = [
      "ec2:CreateVpc", "ec2:DeleteVpc", "ec2:ModifyVpcAttribute",
      "ec2:CreateSubnet", "ec2:DeleteSubnet", "ec2:ModifySubnetAttribute",
      "ec2:CreateInternetGateway", "ec2:DeleteInternetGateway",
      "ec2:AttachInternetGateway", "ec2:DetachInternetGateway",
      "ec2:CreateRouteTable", "ec2:DeleteRouteTable",
      "ec2:CreateRoute", "ec2:DeleteRoute",
      "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable",
      "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
      "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
      "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
      "ec2:CreateTags", "ec2:DeleteTags",
    ]
    resources = ["*"]
  }

  # --- ECS ---
  # ECS Register/Describe TaskDefinition don't support family-level
  # conditions; UpdateService etc. would, but for a POC just allow ecs:*.
  statement {
    sid       = "Ecs"
    actions   = ["ecs:*"]
    resources = ["*"]
  }

  # --- ECR ---
  statement {
    sid = "EcrManage"
    actions = [
      "ecr:CreateRepository", "ecr:DeleteRepository",
      "ecr:DescribeRepositories", "ecr:ListTagsForResource",
      "ecr:TagResource", "ecr:UntagResource",
      "ecr:PutLifecyclePolicy", "ecr:GetLifecyclePolicy", "ecr:DeleteLifecyclePolicy",
      "ecr:PutImageScanningConfiguration", "ecr:GetRepositoryPolicy",
      "ecr:SetRepositoryPolicy", "ecr:DeleteRepositoryPolicy",
      "ecr:PutImageTagMutability", "ecr:GetRegistryPolicy",
    ]
    resources = [
      "arn:aws:ecr:*:*:repository/enhanced-review",
      "arn:aws:ecr:*:*:repository/enhanced-review-*",
    ]
  }
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # --- ELBv2 (ALB) ---
  statement {
    sid       = "Elbv2"
    actions   = ["elasticloadbalancing:*"]
    resources = ["*"]
  }

  # --- EFS ---
  statement {
    sid       = "Efs"
    actions   = ["elasticfilesystem:*"]
    resources = ["*"]
  }

  # --- ACM ---
  statement {
    sid       = "Acm"
    actions   = ["acm:*"]
    resources = ["*"]
  }

  # --- Cognito ---
  statement {
    sid       = "Cognito"
    actions   = ["cognito-idp:*"]
    resources = ["*"]
  }

  # --- Route 53 ---
  statement {
    sid       = "Route53"
    actions   = ["route53:*"]
    resources = ["*"]
  }

  # --- Secrets Manager (scoped to this app's namespace) ---
  statement {
    sid     = "SecretsManager"
    actions = ["secretsmanager:*"]
    resources = [
      "arn:aws:secretsmanager:*:*:secret:enhanced-review/*",
    ]
  }
  statement {
    sid       = "SecretsManagerList"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }

  # --- IAM roles (scoped to enhanced-review-* and platform-*) ---
  statement {
    sid = "IamRoles"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
      "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
      "iam:PassRole",
    ]
    resources = [
      "arn:aws:iam::*:role/enhanced-review-*",
      "arn:aws:iam::*:role/platform-*",
    ]
  }

  # --- IAM OIDC provider (single, GitHub-specific) ---
  statement {
    sid = "IamOidc"
    actions = [
      "iam:CreateOpenIDConnectProvider", "iam:GetOpenIDConnectProvider",
      "iam:DeleteOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint",
      "iam:TagOpenIDConnectProvider", "iam:UntagOpenIDConnectProvider",
      "iam:ListOpenIDConnectProviderTags",
      "iam:AddClientIDToOpenIDConnectProvider", "iam:RemoveClientIDFromOpenIDConnectProvider",
    ]
    resources = [
      "arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com",
    ]
  }
  statement {
    sid       = "IamOidcList"
    actions   = ["iam:ListOpenIDConnectProviders"]
    resources = ["*"]
  }

  # --- CloudWatch Logs (scoped to this app's log groups) ---
  statement {
    sid     = "Logs"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:*:*:log-group:/ecs/enhanced-review*",
      "arn:aws:logs:*:*:log-group:/ecs/enhanced-review*:*",
    ]
  }
  statement {
    sid = "LogsDescribe"
    actions = [
      "logs:DescribeLogGroups",
      "logs:ListTagsLogGroup",
      "logs:ListTagsForResource",
    ]
    resources = ["*"]
  }

  # --- State backend (S3 + DynamoDB) ---
  statement {
    sid = "S3State"
    actions = [
      "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
      "s3:ListBucket", "s3:GetBucketVersioning",
    ]
    resources = [
      "arn:aws:s3:::enhanced-review-tfstate-*",
      "arn:aws:s3:::enhanced-review-tfstate-*/*",
    ]
  }
  statement {
    sid = "DynamoLock"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
    ]
    resources = ["arn:aws:dynamodb:*:*:table/enhanced-review-tflock"]
  }

  # --- STS (caller identity for `data.aws_caller_identity.current`) ---
  statement {
    sid       = "Sts"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_tf" {
  name   = "enhanced-review-github-tf"
  role   = aws_iam_role.github_tf.id
  policy = data.aws_iam_policy_document.github_tf.json
}
