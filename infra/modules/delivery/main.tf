variable "name_prefix" { type = string }
variable "image_digest" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "isolated_subnet_ids" { type = list(string) }
variable "vpc_id" { type = string }
variable "endpoint_security_group_id" { type = string }
variable "certificate_arn" {
  type = string
  validation {
    condition     = var.certificate_arn != null && can(regex("^arn:aws:acm:eu-west-1:[0-9]{12}:certificate/[0-9a-f-]{36}$", var.certificate_arn))
    error_message = "an explicit eu-west-1 ACM certificate ARN is required"
  }
}
variable "environment" { type = string }
variable "desired_count" { type = number }
variable "min_capacity" { type = number }
variable "max_capacity" { type = number }
variable "tags" { type = map(string) }
variable "monthly_budget_usd" { type = number }
variable "budget_notification_emails" { type = list(string) }
variable "cognito_user_pool_id" {
  type    = string
  default = null
}
variable "cognito_client_id" {
  type    = string
  default = null
}
variable "cognito_issuer_url" { type = string }

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
locals {
  image_uri             = "${aws_ecr_repository.app.repository_url}@${var.image_digest}"
  log_options           = jsonencode({ "awslogs-group" = aws_cloudwatch_log_group.app.name, "awslogs-region" = data.aws_region.current.region, "awslogs-stream-prefix" = "runtime" })
  api_environment       = jsonencode([{ name = "ENVIRONMENT", value = "production" }, { name = "DATABASE_ENGINE", value = "postgresql" }, { name = "AUTH_MODE", value = "jwt" }, { name = "JWT_ISSUER", value = var.cognito_issuer_url }, { name = "JWT_CLIENT_ID", value = coalesce(var.cognito_client_id, "") }, { name = "AWS_REGION", value = data.aws_region.current.region }, { name = "REPORT_QUEUE_URL", value = aws_sqs_queue.work.url }, { name = "REPORT_BUCKET_NAME", value = aws_s3_bucket.reports.bucket }, { name = "DATABASE_SSL_MODE", value = "require" }, { name = "DATABASE_SSL_CA_PATH", value = "/app/certs/global-bundle.pem" }, { name = "DB_SSL", value = "true" }, { name = "JWT_ADMIN_GROUP", value = "platform-admin" }])
  migration_environment = jsonencode([{ name = "ENVIRONMENT", value = "production" }, { name = "DATABASE_ENGINE", value = "postgresql" }, { name = "AWS_REGION", value = data.aws_region.current.region }, { name = "DATABASE_SSL_MODE", value = "require" }, { name = "DATABASE_SSL_CA_PATH", value = "/app/certs/global-bundle.pem" }])
  publisher_environment = jsonencode([{ name = "ENVIRONMENT", value = "production" }, { name = "DATABASE_ENGINE", value = "postgresql" }, { name = "AWS_REGION", value = data.aws_region.current.region }, { name = "REPORT_QUEUE_URL", value = aws_sqs_queue.work.url }, { name = "DATABASE_SSL_MODE", value = "require" }, { name = "DATABASE_SSL_CA_PATH", value = "/app/certs/global-bundle.pem" }])
  worker_environment    = jsonencode([{ name = "ENVIRONMENT", value = "production" }, { name = "DATABASE_ENGINE", value = "postgresql" }, { name = "AWS_REGION", value = data.aws_region.current.region }, { name = "REPORT_QUEUE_URL", value = aws_sqs_queue.work.url }, { name = "REPORT_BUCKET_NAME", value = aws_s3_bucket.reports.bucket }, { name = "DATABASE_SSL_MODE", value = "require" }, { name = "DATABASE_SSL_CA_PATH", value = "/app/certs/global-bundle.pem" }])
  database_secret       = jsonencode([{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database.arn }])
  api_secrets           = jsonencode([{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database.arn }, { name = "CURSOR_SIGNING_SECRET", valueFrom = aws_secretsmanager_secret.cursor_signing.arn }])
}

resource "aws_kms_key" "data" {
  description         = "${var.name_prefix} application data encryption"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EnableAccountRoot"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
  tags = var.tags
}
resource "aws_kms_alias" "data" {
  name          = "alias/${var.name_prefix}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_ecr_repository" "app" {
  name                 = var.name_prefix
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
  tags = var.tags
}
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Expire untagged images after 30 days", selection = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 30 }, action = { type = "expire" } }] })
}
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name_prefix}"
  retention_in_days = var.environment == "prod" ? 90 : 30
  kms_key_id        = aws_kms_key.data.arn
  tags              = var.tags
}

resource "aws_sqs_queue" "dlq" {
  name                              = "${var.name_prefix}-dlq"
  kms_master_key_id                 = aws_kms_key.data.arn
  kms_data_key_reuse_period_seconds = 300
  tags                              = var.tags
}
resource "aws_sqs_queue" "work" {
  name                              = "${var.name_prefix}-work"
  visibility_timeout_seconds        = 60
  kms_master_key_id                 = aws_kms_key.data.arn
  kms_data_key_reuse_period_seconds = 300
  redrive_policy                    = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 3 })
  redrive_allow_policy              = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.work.arn] })
  tags                              = var.tags
}

resource "aws_s3_bucket" "reports" {
  bucket_prefix = "${var.name_prefix}-reports-"
  force_destroy = false
  tags          = var.tags
}
resource "aws_s3_bucket_versioning" "reports" {
  bucket = aws_s3_bucket.reports.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_ownership_controls" "reports" {
  bucket = aws_s3_bucket.reports.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_public_access_block" "reports" {
  bucket                  = aws_s3_bucket.reports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.data.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id
  rule {
    id     = "expire-reports"
    status = "Enabled"
    expiration { days = var.environment == "prod" ? 90 : 30 }
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}
resource "aws_s3_bucket_policy" "reports" {
  bucket = aws_s3_bucket.reports.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.reports.arn, "${aws_s3_bucket.reports.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }] })
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}
resource "aws_security_group" "alb" {
  name   = "${var.name_prefix}-alb-sg"
  vpc_id = var.vpc_id
  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    protocol    = "tcp"
    from_port   = 3000
    to_port     = 3000
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = var.tags
}
resource "aws_security_group" "task" {
  name   = "${var.name_prefix}-task-sg"
  vpc_id = var.vpc_id
  ingress {
    protocol        = "tcp"
    from_port       = 3000
    to_port         = 3000
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    protocol    = "tcp"
    from_port   = 5432
    to_port     = 5432
    cidr_blocks = ["10.0.0.0/8"]
  }
  egress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["10.0.0.0/8"]
  }
  tags = var.tags
}
resource "aws_security_group" "db" {
  name   = "${var.name_prefix}-db-sg"
  vpc_id = var.vpc_id
  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.task.id]
  }
  tags = var.tags
}
resource "aws_lb" "private" {
  name                       = substr("${var.name_prefix}-alb", 0, 32)
  internal                   = true
  load_balancer_type         = "application"
  drop_invalid_header_fields = true
  subnets                    = var.private_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  tags                       = var.tags
}
resource "aws_lb_target_group" "app" {
  name        = substr("${var.name_prefix}-tg", 0, 32)
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check {
    path     = "/healthz"
    matcher  = "200"
    interval = 30
  }
}
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.private.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
resource "aws_lb_listener" "https" {
  count             = 1
  load_balancer_arn = aws_lb.private.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
resource "aws_wafv2_web_acl" "alb" {
  name  = "${var.name_prefix}-waf"
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  rule {
    name     = "AWSManagedCommonRules"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-managed"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "RateLimit"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate"
      sampled_requests_enabled   = false
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf"
    sampled_requests_enabled   = false
  }
  tags = var.tags
}
resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.private.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}

resource "aws_secretsmanager_secret" "database" {
  name       = "${var.name_prefix}/database"
  kms_key_id = aws_kms_key.data.arn
  tags       = var.tags
}
resource "aws_secretsmanager_secret" "cursor_signing" {
  name       = "${var.name_prefix}/cursor-signing-secret"
  kms_key_id = aws_kms_key.data.arn
  tags       = var.tags
}
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = var.tags
}
resource "aws_iam_role_policy" "execution" {
  role   = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" }, { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = aws_ecr_repository.app.arn }, { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.app.arn}:*" }, { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.database.arn, aws_secretsmanager_secret.cursor_signing.arn] }, { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.data.arn }] })
}
resource "aws_iam_role" "api" {
  name               = "${var.name_prefix}-api"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
  tags               = var.tags
}
resource "aws_iam_role_policy" "api" {
  role = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue", "kms:Decrypt"], Resource = [aws_secretsmanager_secret.database.arn, aws_secretsmanager_secret.cursor_signing.arn, aws_kms_key.data.arn] },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.reports.arn}/*" }
  ] })
}
resource "aws_iam_role" "publisher" {
  name               = "${var.name_prefix}-publisher"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
  tags               = var.tags
}
resource "aws_iam_role_policy" "publisher" {
  role = aws_iam_role.publisher.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue", "kms:Decrypt"], Resource = [aws_secretsmanager_secret.database.arn, aws_secretsmanager_secret.cursor_signing.arn, aws_kms_key.data.arn] },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.work.arn }
  ] })
}
resource "aws_iam_role" "worker" {
  name               = "${var.name_prefix}-worker"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
  tags               = var.tags
}
resource "aws_iam_role_policy" "worker" {
  role = aws_iam_role.worker.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue", "kms:Decrypt"], Resource = [aws_secretsmanager_secret.database.arn, aws_secretsmanager_secret.cursor_signing.arn, aws_kms_key.data.arn] },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.work.arn },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.reports.arn}/*" }
  ] })
}
resource "aws_iam_role" "migration" {
  name               = "${var.name_prefix}-migration"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
  tags               = var.tags
}
resource "aws_iam_role_policy" "migration" {
  role = aws_iam_role.migration.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.database.arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.data.arn }
  ] })
}
resource "aws_ecs_task_definition" "app" {
  family                   = var.name_prefix
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api.arn
  container_definitions    = templatefile("${path.module}/templates/api.json.tftpl", { image = local.image_uri, environment = local.api_environment, secrets = local.api_secrets, log_options = local.log_options })
  ephemeral_storage { size_in_gib = 21 }
  tags = var.tags
}
resource "aws_ecs_task_definition" "migration" {
  family                   = "${var.name_prefix}-migration"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.migration.arn
  container_definitions    = templatefile("${path.module}/templates/migration.json.tftpl", { image = local.image_uri, environment = local.migration_environment, secrets = local.database_secret, log_options = local.log_options })
  tags                     = var.tags
}
resource "aws_ecs_task_definition" "outbox_publisher" {
  family                   = "${var.name_prefix}-outbox-publisher"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.publisher.arn
  container_definitions    = templatefile("${path.module}/templates/publisher.json.tftpl", { image = local.image_uri, environment = local.publisher_environment, secrets = local.database_secret, log_options = local.log_options })
  tags                     = var.tags
}
resource "aws_ecs_task_definition" "report_worker" {
  family                   = "${var.name_prefix}-report-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker.arn
  container_definitions    = templatefile("${path.module}/templates/worker.json.tftpl", { image = local.image_uri, environment = local.worker_environment, secrets = local.database_secret, log_options = local.log_options })
  tags                     = var.tags
}
resource "aws_ecs_service" "app" {
  name                   = var.name_prefix
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.app.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }
  tags = var.tags
  lifecycle {
    precondition {
      condition     = var.environment != "prod" || var.desired_count >= 2
      error_message = "prod requires at least two ECS tasks"
    }
  }
}
resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}
resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name_prefix}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    target_value = 60
  }
}
resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  alarm_name  = "${var.name_prefix}-unhealthy"
  namespace   = "AWS/ApplicationELB"
  metric_name = "UnHealthyHostCount"
  dimensions = {
    LoadBalancer = aws_lb.private.arn_suffix
    TargetGroup  = aws_lb_target_group.app.arn_suffix
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name_prefix}-alb-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.private.arn_suffix }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "alb_latency" {
  alarm_name          = "${var.name_prefix}-alb-latency"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = aws_lb.private.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  alarm_name          = "${var.name_prefix}-ecs-memory"
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.this.name, ServiceName = aws_ecs_service.app.name }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "ecs_running_shortfall" {
  alarm_name          = "${var.name_prefix}-ecs-running-shortfall"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = aws_ecs_cluster.this.name, ServiceName = aws_ecs_service.app.name }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = var.environment == "prod" ? 2 : 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}
resource "aws_cloudwatch_metric_alarm" "certificate_expiry" {
  alarm_name          = "${var.name_prefix}-certificate-expiry"
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  dimensions          = { CertificateArn = var.certificate_arn }
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 30
  comparison_operator = "LessThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "waf_blocked" {
  alarm_name  = "${var.name_prefix}-waf-blocked"
  namespace   = "AWS/WAFV2"
  metric_name = "BlockedRequests"
  dimensions = {
    WebACL = aws_wafv2_web_acl.alb.name
    Rule   = "ALL"
    Region = data.aws_region.current.region
  }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${var.name_prefix}-queue-age"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.work.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 300
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "dlq_visible" {
  alarm_name          = "${var.name_prefix}-dlq-visible"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd > 0 && length(var.budget_notification_emails) > 0 ? 1 : 0
  name         = "${var.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$legacy-application-modernization"]
  }
  dynamic "notification" {
    for_each = var.budget_notification_emails
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "FORECASTED"
      subscriber_email_addresses = [notification.value]
    }
  }
  tags = var.tags
}
resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name_prefix
  dashboard_body = jsonencode({ widgets = [
    { type = "metric", width = 12, height = 6, properties = { title = "ALB and ECS health", metrics = [["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.private.arn_suffix], ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.this.name, "ServiceName", aws_ecs_service.app.name]], period = 60, stat = "Sum", region = data.aws_region.current.region } },
    { type = "metric", width = 12, height = 6, properties = { title = "Report queue", metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.work.name], ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.work.name]], period = 60, stat = "Maximum", region = data.aws_region.current.region } }
  ] })
}

output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "image_uri" { value = local.image_uri }
output "alb_dns_name" { value = aws_lb.private.dns_name }
output "alb_arn" { value = aws_lb.private.arn }
output "database_secret_arn" { value = aws_secretsmanager_secret.database.arn }
output "cursor_secret_arn" { value = aws_secretsmanager_secret.cursor_signing.arn }
output "task_security_group_id" { value = aws_security_group.task.id }
