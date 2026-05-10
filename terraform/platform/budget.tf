# Account-level monthly cost alarm. Free safety net via AWS Budgets'
# built-in email notifications (no SNS in the loop — Budgets sends mail
# directly to subscriber_email_addresses).
#
# Per doc 09 the steady-state monthly spend is ~$37, so 80% of $50 = $40
# may fire mid-month if Anthropic API spend is non-trivial. Adjust
# limit_amount or threshold percentages if false positives become annoying.
#
# Account-scoped (lives in the platform module) because budgets fire on
# total account spend; if a second app joins this platform later, the
# alarm covers it too.

resource "aws_budgets_budget" "monthly" {
  name         = "platform-monthly-50usd"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # 80% actual: mid-month heads-up.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  # 100% actual: month-end exceedance.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  # 120% forecasted: heads-up that current burn rate will exceed budget.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 120
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
