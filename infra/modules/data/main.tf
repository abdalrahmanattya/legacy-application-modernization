variable "name_prefix" { type = string }
variable "subnet_ids" { type = list(string) }
variable "multi_az" { type = bool }
variable "tags" { type = map(string) }
variable "vpc_id" { type = string }
variable "task_security_group_id" { type = string }
resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}
resource "aws_db_instance" "postgres" {
  identifier                      = "${var.name_prefix}-postgres"
  engine                          = "postgres"
  engine_version                  = "16"
  instance_class                  = var.multi_az ? "db.t4g.small" : "db.t4g.micro"
  allocated_storage               = 20
  storage_encrypted               = true
  multi_az                        = var.multi_az
  publicly_accessible             = false
  db_subnet_group_name            = aws_db_subnet_group.this.name
  backup_retention_period         = var.multi_az ? 7 : 1
  deletion_protection             = var.multi_az
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.name_prefix}-final"
  username                        = "appadmin"
  manage_master_user_password     = true
  vpc_security_group_ids          = [aws_security_group.db.id]
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  parameter_group_name            = aws_db_parameter_group.postgres.name
  tags                            = var.tags
}
resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.name_prefix}-db-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${var.name_prefix}-db-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 2147483648
  comparison_operator = "LessThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name          = "${var.name_prefix}-db-connections"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
resource "aws_security_group" "db" {
  name   = "${var.name_prefix}-db-sg"
  vpc_id = var.vpc_id
  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [var.task_security_group_id]
  }
  tags = var.tags
}
resource "aws_db_parameter_group" "postgres" {
  name   = "${var.name_prefix}-postgres16"
  family = "postgres16"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  tags = var.tags
}
output "db_endpoint" { value = aws_db_instance.postgres.address }
