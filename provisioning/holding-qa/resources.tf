provider "aws" {
  region     = "us-east-1"
}

terraform {
  # Use s3 to store terraform state
  backend "s3" {
    bucket  = "nypl-github-actions-builds-qa"
    key     = "holding-poster-qa-state"
    region  = "us-east-1"
  }
}

module "base" {
  source = "../base"

  environment = "qa"

  function_name = "HoldingPoster"

  vpc_config = {
    # Update these if your QA subnets/security groups differ from production
    subnet_ids         = ["subnet-59bcdd03", "subnet-5deecd15"]
    security_group_ids = ["sg-116eeb60"]
  }
}