output "api_gateway_endpoint" {
  description = "Base HTTPS URL of the AWS API Gateway"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "slack_events_request_url" {
  description = "Request URL to paste into Slack Event Subscriptions"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}slack/events"
}

output "slack_commands_request_url" {
  description = "Request URL to paste into Slack Slash Commands (/book-travel)"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}slack/commands"
}

output "slack_interactions_request_url" {
  description = "Request URL to paste into Slack Interactivity & Shortcuts"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}slack/interactions"
}

output "dynamodb_table_name" {
  description = "Name of the deployed DynamoDB table"
  value       = aws_dynamodb_table.travel_bookings.name
}

output "dynamodb_table_arn" {
  description = "ARN of the DynamoDB table"
  value       = aws_dynamodb_table.travel_bookings.arn
}

output "slack_handler_lambda_arn" {
  description = "ARN of the Slack Webhook Lambda Function"
  value       = aws_lambda_function.slack_handler.arn
}

output "flight_reminder_lambda_arn" {
  description = "ARN of the 24h Flight Reminder Lambda Function"
  value       = aws_lambda_function.flight_reminder.arn
}

