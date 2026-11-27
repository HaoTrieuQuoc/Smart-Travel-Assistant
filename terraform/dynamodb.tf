resource "aws_dynamodb_table" "travel_bookings" {
  name         = var.dynamodb_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "trip_id"

  attribute {
    name = "trip_id"
    type = "S"
  }

  attribute {
    name = "reminder_sent"
    type = "S"
  }

  attribute {
    name = "departure_time"
    type = "S"
  }

  # Global Secondary Index: DepartureTimeIndex
  # Enables fast range queries for pending 24-hour departure flight reminders
  global_secondary_index {
    name            = "DepartureTimeIndex"
    hash_key        = "reminder_sent"
    range_key       = "departure_time"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = var.dynamodb_table_name
    Description = "Storage for enterprise travel bookings with audit hashing"
  }
}

