provider "aws" {
  region     = "us-east-1"
}

locals {
  tags = {
    Project = "Research Catalog"
    BusinessUnit = "LSP"
  }
}

variable "environment" {
  type = string
  default = "qa"
  description = "The name of the environment (qa, production). This controls the name of lambda and the env vars loaded."

  validation {
    condition     = contains(["qa", "production"], var.environment)
    error_message = "The environment must be 'qa' or 'production'."
  }
}

variable "vpc_config" {
  type = map
  description = "VPC config params"
}

variable "function_name" {
  type        = string
  description = "The name of the function (e.g. BibPoster or ItemPoster)"
}

# Package the app as a zip:
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/dist.zip"
  source_dir  = "../../"
  excludes    = [".git", ".terraform", "provisioning", "test", "scripts"]
}

# Upload the zipped app to S3:
resource "aws_s3_object" "uploaded_zip" {
  bucket = "nypl-github-actions-builds-${var.environment}"
  key    = "discovery-poster-${var.environment}-dist.zip"
  acl    = "private"
  source = data.archive_file.lambda_zip.output_path
  etag   = filemd5(data.archive_file.lambda_zip.output_path)
  tags = local.tags
}

# Create the lambda:
resource "aws_lambda_function" "lambda_instance" {
  description   = "Lambda for posting to the Bib/Item API"
  function_name = "${var.function_name}-${var.environment}"
  handler       = "index.handler"
  memory_size   = 512
  role          = "arn:aws:iam::946183545209:role/lambda-full-access"
  runtime       = "nodejs20.x"
  timeout       = 300

  # Location of the zipped code in S3:
  s3_bucket     = aws_s3_object.uploaded_zip.bucket
  s3_key        = aws_s3_object.uploaded_zip.key

    # Trigger pulling code from S3 when the zip has changed:
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256


  # Load ENV vars from config and explicitly inject FUNCTION_NAME / ENVIRONMENT
  environment {
    variables = merge(
      { for tuple in regexall("(.*?)=(.*)", try(file("../../config/${var.function_name}-${var.environment}.env"), file("../../config/${var.environment}.env"), "")) : tuple[0] => tuple[1] },
      {
        FUNCTION_NAME = var.function_name
        ENVIRONMENT   = var.environment
      }
    )
  }
  
  vpc_config {
    subnet_ids         = var.vpc_config.subnet_ids
    security_group_ids = var.vpc_config.security_group_ids
  }
  
  tags = local.tags
}

data "aws_sns_topic" "rc_alarms" {
  name = "research-catalog-team-alarms-${var.environment}"

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "lambda-errors-${aws_lambda_function.lambda_instance.function_name}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  alarm_description   = "Lambda function ${aws_lambda_function.lambda_instance.function_name} has more than 1 error in 5 minutes"
  alarm_actions       = [data.aws_sns_topic.rc_alarms.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.lambda_instance.function_name
  }

  tags = local.tags
}
