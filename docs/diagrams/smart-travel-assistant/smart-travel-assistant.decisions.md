---
diagram: "smart-travel-assistant"
document: "decisions"
prefix: "STA"
updated: "2026-11-18"
---

# Smart Travel Assistant - AWS Serverless Architecture - Decisions

## Next

All architecture routes and components are verified and stamped.

## Decisions

### STA-D1: Serverless Architecture on AWS ap-southeast-2
- Decision: Host all application logic on AWS Lambda, API Gateway HTTP v2, DynamoDB, and EventBridge in Sydney region (ap-southeast-2).
- Why: Eliminates idle hosting costs while maintaining low-latency execution for Asia-Pacific enterprise users.
- Breaks if ignored: Incurring unnecessary EC2/RDS monthly costs without serverless automatic scaling.
- Rejected: Containerized ECS Fargate or EC2 instances, due to baseline monthly idle hosting expenses.

### STA-D2: Dual-Write Storage with SHA-256 Check-Diff
- Decision: Synchronize every confirmed itinerary across Google Sheets (23 columns) and DynamoDB (TravelBookings) with an idempotent SHA-256 row hash.
- Why: Guarantees business transparency for HR/Finance while preventing duplicate database writes and detecting unauthorized sheet modifications.
- Breaks if ignored: Data discrepancies between Slack, spreadsheets, and database.
- Rejected: Single-store design (Sheets-only or DynamoDB-only), as Sheets lacks millisecond transactional indexing and DynamoDB lacks accessible user-facing UI.

### STA-D3: Sub-100ms Async Handshake for Slack Timeout Prevention
- Decision: Slack events immediately return HTTP 200 OK via asynchronous Lambda self-invocation before executing OCR or Sheets API calls.
- Why: Slack enforces a strict 3,000ms HTTP timeout. AI Vision OCR requires 1.5-3.0 seconds, which would cause Slack retry loops.
- Breaks if ignored: Slack error messages (operation_timeout) and duplicated user requests.
- Rejected: Synchronous processing inside the initial webhook request.

## Open
