resource "aws_ecs_cluster" "main" {
  name = "platform-cluster"

  setting {
    name = "containerInsights"
    # Off for the POC tier — adds CloudWatch metric cost. Flip to "enabled"
    # if alarms become useful (see docs/ecs-migration/09-cost-and-operations.md).
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}
