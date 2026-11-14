# Archive Lambda Source Code
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda"
  output_path = "${path.module}/dist/lambda_package.zip"
}

# 1. Slack Webhook Handler Lambda
resource "aws_lambda_function" "slack_handler" {
  function_name    = "${var.project_name}-slack-handler"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  role             = aws_iam_role.lambda_role.arn
  handler          = "slack_handler.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 30

  environment {
    variables = {
      DYNAMODB_TABLE_NAME         = aws_dynamodb_table.travel_bookings.name
      SLACK_BOT_TOKEN             = var.slack_bot_token
      SLACK_SIGNING_SECRET        = var.slack_signing_secret
      SLACK_ADMIN_CHANNEL_ID      = var.slack_admin_channel_id
      GOOGLE_SHEET_ID             = var.google_sheet_id
      GOOGLE_SHEET_TAB_NAME       = var.google_sheet_tab_name
      GOOGLE_SERVICE_ACCOUNT_JSON = var.google_service_account_json
      OPENROUTER_API_KEY          = var.openrouter_api_key
      AI_MODEL                    = var.ai_model
    }
  }

  tags = {
    Name = "${var.project_name}-slack-handler"
  }
}

# 2. 24h Flight Reminder Cron Lambda
resource "aws_lambda_function" "flight_reminder" {
  function_name    = "${var.project_name}-flight-reminder"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  role             = aws_iam_role.lambda_role.arn
  handler          = "reminder_cron.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 60

  environment {
    variables = {
      DYNAMODB_TABLE_NAME         = aws_dynamodb_table.travel_bookings.name
      SLACK_BOT_TOKEN             = var.slack_bot_token
      SLACK_ADMIN_CHANNEL_ID      = var.slack_admin_channel_id
      GOOGLE_SHEET_ID             = var.google_sheet_id
      GOOGLE_SHEET_TAB_NAME       = var.google_sheet_tab_name
      GOOGLE_SERVICE_ACCOUNT_JSON = var.google_service_account_json
      OPENROUTER_API_KEY          = var.openrouter_api_key
      AI_MODEL                    = var.ai_model
    }
  }

  tags = {
    Name = "${var.project_name}-flight-reminder"
  }
}

