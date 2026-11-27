# EventBridge Rule for Hourly 24h Flight Reminders
# Runs every hour so flights departing within the next 24h are reminded on time
resource "aws_cloudwatch_event_rule" "daily_flight_reminder" {
  name                = "${var.project_name}-daily-reminder-rule"
  description         = "Triggers 24-hour flight reminder Lambda every hour"
  schedule_expression = "rate(1 hour)"

  tags = {
    Name = "${var.project_name}-daily-reminder-rule"
  }
}

# Target: Flight Reminder Lambda
resource "aws_cloudwatch_event_target" "flight_reminder_target" {
  rule      = aws_cloudwatch_event_rule.daily_flight_reminder.name
  target_id = "FlightReminderLambdaTarget"
  arn       = aws_lambda_function.flight_reminder.arn
}

# Permission for EventBridge to invoke Lambda
resource "aws_lambda_permission" "eventbridge_permission" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.flight_reminder.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_flight_reminder.arn
}

