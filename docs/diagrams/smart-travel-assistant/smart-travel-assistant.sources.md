---
diagram: "smart-travel-assistant"
document: "sources"
updated: "2026-11-18"
stamped: "2026-11-18"
---

# Smart Travel Assistant - AWS Serverless Architecture - Sources

Where each drawn fact comes from. Edit Route, Nodes, Source and Anchor by hand; `records.py stamp` writes the Fingerprint, Updated, Watermark, Files and render columns.

## Repositories

| Alias | Path |
|---|---|
| repo | . |

## Source map

| Area | Owning source | Entry point | Diagram nodes |
|---|---|---|---|
| Workspace | repo:README.md | heading:2. Proposed Solution | traveler, slack_app |
| Ingress | repo:terraform/api_gateway.tf | code:resource "aws_apigatewayv2_api" | apigw |
| Scheduling | repo:terraform/eventbridge.tf | code:resource "aws_cloudwatch_event_rule" | eventbridge |
| Compute | repo:terraform/lambda.tf | code:resource "aws_lambda_function" | slack_lambda, reminder_lambda |
| Storage | repo:terraform/dynamodb.tf | code:resource "aws_dynamodb_table" | dynamodb |
| Observability | repo:terraform/iam.tf | code:AWSLambdaBasicExecutionRole | cloudwatch |
| AI Integration | repo:lambda/ai_ocr_service.js | code:function callOpenRouter | openrouter |
| Enterprise Sheet | repo:lambda/slack_handler.js | code:async function saveTripRecord | gsheets |

## Routes

| Route | Nodes | Source | Anchor | Fingerprint |
|---|---|---|---|---|
| R1 | traveler | repo:README.md | heading:2. Proposed Solution | 7b977091e02c |
| R2 | slack_app | repo:README.md | heading:3. End-to-End Workflow | 91b43d8411b3 |
| R3 | apigw | repo:terraform/api_gateway.tf | code:resource "aws_apigatewayv2_api" "slack_api" | 4fa45a98cf37 |
| R4 | eventbridge | repo:terraform/eventbridge.tf | code:resource "aws_cloudwatch_event_rule" "daily_flight_reminder" | 9261e6142156 |
| R5 | slack_lambda | repo:terraform/lambda.tf | code:resource "aws_lambda_function" "slack_handler" | 2c7c9b494b04 |
| R6 | reminder_lambda | repo:terraform/lambda.tf | code:resource "aws_lambda_function" "flight_reminder" | 51076bda09a8 |
| R7 | dynamodb | repo:terraform/dynamodb.tf | code:resource "aws_dynamodb_table" "travel_bookings" | 7989a7b01640 |
| R8 | cloudwatch | repo:terraform/iam.tf | code:AWSLambdaBasicExecutionRole | d1561d8976a6 |
| R9 | openrouter | repo:lambda/ai_ocr_service.js | code:function callOpenRouter | 3f483812bbda |
| R10 | gsheets | repo:lambda/slack_handler.js | code:async function saveTripRecord | ecf603ab7bcf |

## Source files

| Source | Owner | Updated | Watermark |
|---|---|---|---|
| repo:README.md | repo | - | - |
| repo:terraform/api_gateway.tf | repo | - | - |
| repo:terraform/eventbridge.tf | repo | - | - |
| repo:terraform/lambda.tf | repo | - | - |
| repo:terraform/dynamodb.tf | repo | - | - |
| repo:terraform/iam.tf | repo | - | - |
| repo:lambda/ai_ocr_service.js | repo | - | - |
| repo:lambda/slack_handler.js | repo | - | - |

## Watched folders

| Folder | Skip | Files |
|---|---|---|
| repo:terraform | - | 0 |

## Verified

| Check | Result | Date |
|---|---|---|
| render --check | 0 errors, 0 warnings | 2026-11-18 |
| screenshot at 1280 | verified | 2026-11-18 |
| chips, walk and card | verified | 2026-11-18 |
