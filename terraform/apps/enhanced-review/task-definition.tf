resource "aws_ecs_task_definition" "app" {
  family                   = var.app_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  volume {
    name = "pgdata"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.pgdata.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.pgdata.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = var.web_image
      command      = var.web_image_command
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "AUTH_TRUST_HOST", value = "true" },
        { name = "AUTH_URL", value = local.app_url },
        # The placeholder doesn't connect to postgres; this is wired up
        # so Phase D's first real image picks up the right value without
        # a task-def edit. Postgres listens on the task's localhost.
        { name = "DATABASE_URL", value = "postgres://app:placeholder@127.0.0.1:5432/enhanced_review" },
        { name = "REVIEW_EXECUTOR", value = "claude" },
        { name = "REVIEW_MODEL", value = "claude-haiku-4-5" },
        { name = "REVIEW_TIMEOUT_MIN", value = "15" },
        { name = "MAX_JOBS_PER_USER", value = "1" },
        { name = "LOG_LEVEL", value = "info" },
      ]
      # Secrets are injected as env vars on container start. Empty during
      # Phase C (task execution role can read them; values populated in
      # Phase D). The placeholder image ignores envs it doesn't use.
      secrets = [
        { name = "AUTH_SECRET", valueFrom = aws_secretsmanager_secret.app["auth-secret"].arn },
        { name = "AUTH_GITHUB_ID", valueFrom = aws_secretsmanager_secret.app["auth-github-id"].arn },
        { name = "AUTH_GITHUB_SECRET", valueFrom = aws_secretsmanager_secret.app["auth-github-secret"].arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.app["anthropic-key"].arn },
      ]
      dependsOn = [{ containerName = "postgres", condition = "HEALTHY" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "web"
        }
      }
      # http-echo answers 200 on every path, so ALB target group's
      # /api/health check passes. Phase D's real image owns /api/health.
    },
    {
      name      = "postgres"
      image     = "postgres:17-alpine"
      essential = true
      environment = [
        { name = "POSTGRES_DB", value = "enhanced_review" },
        { name = "POSTGRES_USER", value = "app" },
        # PGDATA is a subdirectory of the mount because EFS root may
        # contain `lost+found` and Postgres refuses non-empty data dirs.
        { name = "PGDATA", value = "/var/lib/postgresql/data/pgdata" },
      ]
      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.app["postgres-password"].arn },
      ]
      mountPoints = [{
        sourceVolume  = "pgdata"
        containerPath = "/var/lib/postgresql/data"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "postgres"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "pg_isready -U app -d enhanced_review || exit 1"]
        interval    = 10
        timeout     = 3
        retries     = 5
        startPeriod = 30
      }
    },
  ])
}
