variable "aws_region" {
  description = "The AWS region to deploy infrastructure"
  type        = string
  default     = "ap-southeast-2"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project identifier used in resource names"
  type        = string
  default     = "smart-travel-assistant"
}

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB table for travel bookings"
  type        = string
  default     = "TravelBookings"
}

variable "slack_bot_token" {
  description = "Slack Bot User OAuth Token (xoxb-...)"
  type        = string
  sensitive   = true
}

variable "slack_signing_secret" {
  description = "Slack App Signing Secret for verifying incoming webhooks"
  type        = string
  sensitive   = true
  default     = ""
}

variable "slack_admin_channel_id" {
  description = "Slack channel ID for admin flight and audit alerts"
  type        = string
  default     = "C0CGLFPNW7R"
}

variable "google_sheet_id" {
  description = "Google Spreadsheet ID for business synchronization"
  type        = string
}

variable "google_sheet_tab_name" {
  description = "Target tab name in Google Sheets"
  type        = string
  default     = "Lịch_Trình_Công_Tác"
}

variable "google_service_account_json" {
  description = "Google Service Account credentials in raw or base64 JSON string"
  type        = string
  sensitive   = true
}

variable "openrouter_api_key" {
  description = "OpenRouter API Key for AI travel guide and ticket OCR"
  type        = string
  sensitive   = true
}

variable "ai_model" {
  description = "AI Model identifier to use on OpenRouter"
  type        = string
  default     = "@preset/free-model-stack"
}

