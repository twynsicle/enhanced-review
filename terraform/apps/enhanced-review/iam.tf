locals {
  account_id = data.aws_caller_identity.current.account_id

  # Constructed ARNs for resources that don't exist yet at IAM-policy-write
  # time but WILL exist by the time the role is assumed (commit 8 creates
  # the service; commit 8 also registers task-def revisions). IAM does not
  # validate that the resource exists when attaching a policy.
  ecs_service_arn         = "arn:aws:ecs:${var.region}:${local.account_id}:service/${local.platform.ecs_cluster_name}/${var.app_name}"
  ecs_task_definition_arn = "arn:aws:ecs:${var.region}:${local.account_id}:task-definition/${var.app_name}:*"

  ecr_repository_arn = local.platform.ecr_repository_arns[var.app_name]
}

# --------- Trust policy: ECS tasks (used by execution role + task role) ---------
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --------- Task execution role ---------
# What ECS itself needs to start the container: pull from ECR, fetch
# secrets into env vars, write to CloudWatch Logs.
resource "aws_iam_role" "task_execution" {
  name               = "${var.app_name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_basic" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# AmazonECSTaskExecutionRolePolicy already grants ECR pull + log writes.
# We add Secrets Manager read scoped to this app's 5 secrets.
data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.app : s.arn]
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "${var.app_name}-task-execution-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

# --------- Task role ---------
# What the running app can call at AWS APIs. The app talks to GitHub +
# Anthropic + its own sidecar postgres on localhost — no AWS APIs. Empty
# role for now; expand here if S3 backups, SES, etc. land later.
resource "aws_iam_role" "task" {
  name               = "${var.app_name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# --------- GitHub OIDC image-deploy role ---------
# Assumed by the .github/workflows/deploy-image.yml job in Phase D.
# Trust scope: this specific repo, on main branch pushes or pull_request.
data "aws_iam_policy_document" "github_image_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.platform.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
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

resource "aws_iam_role" "github_image_deploy" {
  name               = "${var.app_name}-github-image-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_image_deploy_trust.json
}

# What the deploy role can do:
#   - ECR push to this app's repo (build/push the image)
#   - ECS register a new task definition revision
#   - ECS update the service (rolling deploy)
#   - iam:PassRole for the two task roles (required by RegisterTaskDefinition
#     when the new revision references them)
data "aws_iam_policy_document" "github_image_deploy" {
  statement {
    sid       = "EcrAuthToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # AWS-required; can't be scoped per repo
  }

  statement {
    sid = "EcrPushToAppRepo"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [local.ecr_repository_arn]
  }

  statement {
    sid = "EcsRegisterTaskDefinition"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
    ]
    resources = ["*"] # ECS doesn't allow scoping these to a family ARN
  }

  statement {
    sid = "EcsUpdateThisService"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
    ]
    resources = [
      local.ecs_service_arn,
      "arn:aws:ecs:${var.region}:${local.account_id}:task/${local.platform.ecs_cluster_name}/*",
    ]
  }

  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task_execution.arn, aws_iam_role.task.arn]
  }
}

resource "aws_iam_role_policy" "github_image_deploy" {
  name   = "${var.app_name}-github-image-deploy"
  role   = aws_iam_role.github_image_deploy.id
  policy = data.aws_iam_policy_document.github_image_deploy.json
}
