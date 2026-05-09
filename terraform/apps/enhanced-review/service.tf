resource "aws_ecs_service" "app" {
  name            = var.app_name
  cluster         = local.platform.ecs_cluster_id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.platform.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true # required because the task lives in a public subnet (no NAT)
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Lets `aws ecs execute-command` open a shell into either container for
  # day-2 ops (psql, log inspection). See doc 09.
  enable_execute_command = true

  # The listener rule is technically not required for the service to come
  # up — ECS just routes traffic to the target group. But ensuring the
  # rule exists before the service registers prevents a race where the
  # task is healthy but the ALB has no rule routing requests at it.
  depends_on = [aws_lb_listener_rule.app]

  lifecycle {
    # Phase D's image-deploy pipeline updates the task definition out of
    # band; ignore those changes so subsequent `terraform apply`s don't
    # fight the pipeline.
    ignore_changes = [task_definition]
  }
}
