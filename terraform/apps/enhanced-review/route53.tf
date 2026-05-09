resource "aws_route53_record" "app" {
  zone_id = local.platform.route53_zone_id
  name    = var.subdomain
  type    = "A"

  alias {
    name                   = local.platform.alb_dns_name
    zone_id                = local.platform.alb_zone_id
    evaluate_target_health = true
  }
}
