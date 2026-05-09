resource "aws_security_group" "task" {
  name        = "${var.app_name}-task"
  description = "ECS task ENI: ingress :3000 from ALB SG only; egress unrestricted (GitHub clones, Anthropic API, ECR, Secrets Manager)."
  vpc_id      = local.platform.vpc_id

  ingress {
    description     = "App port from platform ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [local.platform.alb_security_group_id]
  }

  egress {
    description = "Outbound to internet (GitHub, Anthropic, ECR, Secrets Manager)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "efs" {
  name        = "${var.app_name}-efs"
  description = "EFS mount targets: NFS (2049) from task SG only."
  vpc_id      = local.platform.vpc_id

  ingress {
    description     = "NFS from app's ECS tasks"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }

  egress {
    description = "Reply traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
