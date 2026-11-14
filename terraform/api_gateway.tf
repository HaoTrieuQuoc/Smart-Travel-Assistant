# HTTP API Gateway (v2) for Slack Webhooks
resource "aws_apigatewayv2_api" "slack_api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
  description   = "Serverless API Gateway for Slack Events, Slash Commands, and Interactions"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "GET", "OPTIONS"]
    allow_headers = ["*"]
  }
}

# Default Stage with Auto-Deploy
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.slack_api.id
  name        = "$default"
  auto_deploy = true

  tags = {
    Environment = var.environment
  }
}

# Integration with Slack Handler Lambda
resource "aws_apigatewayv2_integration" "slack_lambda_integration" {
  api_id                 = aws_apigatewayv2_api.slack_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.slack_handler.arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# Routes: /slack/events
resource "aws_apigatewayv2_route" "slack_events" {
  api_id    = aws_apigatewayv2_api.slack_api.id
  route_key = "POST /slack/events"
  target    = "integrations/${aws_apigatewayv2_integration.slack_lambda_integration.id}"
}

# Routes: /slack/commands
resource "aws_apigatewayv2_route" "slack_commands" {
  api_id    = aws_apigatewayv2_api.slack_api.id
  route_key = "POST /slack/commands"
  target    = "integrations/${aws_apigatewayv2_integration.slack_lambda_integration.id}"
}

# Routes: /slack/interactions
resource "aws_apigatewayv2_route" "slack_interactions" {
  api_id    = aws_apigatewayv2_api.slack_api.id
  route_key = "POST /slack/interactions"
  target    = "integrations/${aws_apigatewayv2_integration.slack_lambda_integration.id}"
}

# Permission for API Gateway to invoke Lambda
resource "aws_lambda_permission" "api_gateway_permission" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.slack_api.execution_arn}/*/*"
}

