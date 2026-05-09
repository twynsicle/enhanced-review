resource "aws_acm_certificate" "wildcard" {
  domain_name               = "*.${var.domain_name}"
  subject_alternative_names = [var.domain_name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# DNS-01 validation. ACM provides one validation record per domain name
# (one for *.<domain>, one for <domain>). The map uses dvo.domain_name as
# the key so each becomes its own aws_route53_record.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

# Blocks until ACM marks the cert ISSUED. May take 5–30 minutes on first
# apply depending on registrar NS propagation. If this hangs past 30 min,
# the most likely cause is that the parent domain's NS records still point
# at the old registrar — verify with `dig +short NS ${var.domain_name}`
# before re-running.
resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
