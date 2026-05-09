# Per-app user pool client. Sits inside the platform's shared user pool;
# each app gets its own client so its callback URL is distinct.
#
# The ALB's authenticate-cognito action exchanges the Cognito session for
# this client; on success the user lands at /oauth2/idpresponse on the
# app's domain, which the ALB consumes and rewrites into a session cookie.
resource "aws_cognito_user_pool_client" "alb" {
  name         = "${var.app_name}-alb"
  user_pool_id = local.platform.cognito_user_pool_id

  generate_secret                      = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = ["${local.app_url}/oauth2/idpresponse"]
  supported_identity_providers         = ["COGNITO"]

  # Default token validity is fine for the POC tier. Refresh-token
  # rotation is on by default in Cognito.
}
