resource "random_id" "cognito_suffix" {
  byte_length = 4
}

resource "aws_cognito_user_pool" "main" {
  name = "platform-users"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  auto_verified_attributes = ["email"]

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }
}

# Cognito-managed hosted UI domain. Globally unique on the cognito-amzn
# domain; the random_id suffix avoids collisions on `terraform apply`.
# Custom domain on Cognito is deferred — the user only sees this URL on
# the first login (Cognito redirects to the app afterward).
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "platform-${random_id.cognito_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.main.id
}
