resource "aws_lb_target_group" "web" {
  name        = "${var.app_name}-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.platform.vpc_id

  health_check {
    path                = "/api/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  # 30s drain on deploy. The runner's in-process job model means draining
  # mid-review loses the job — accepted POC trade-off (see doc 04).
  deregistration_delay = 30
}

# Listener rule attached to the platform's HTTPS listener. Matches host
# header for this app's subdomain and gates with Cognito.
#
# Convention: each registered app uses a fixed priority (this app=100,
# next app=110, etc.). Ten-step gaps leave room to insert per-path rules
# above an app's catch-all if needed (e.g. a /webhooks/* bypass).
resource "aws_lb_listener_rule" "app" {
  listener_arn = local.platform.alb_listener_https_arn
  priority     = 100

  condition {
    host_header {
      values = ["${var.subdomain}.${local.platform.domain_name}"]
    }
  }

  action {
    type  = "authenticate-cognito"
    order = 1
    authenticate_cognito {
      user_pool_arn       = local.platform.cognito_user_pool_arn
      user_pool_client_id = aws_cognito_user_pool_client.alb.id
      user_pool_domain    = local.platform.cognito_user_pool_domain
      session_timeout     = 86400 * 7 # 1 week
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.web.arn
  }
}
