resource "aws_efs_file_system" "pgdata" {
  creation_token = "${var.app_name}-pgdata"
  encrypted      = true

  performance_mode = "generalPurpose" # default; "maxIO" is for >1000 ops/s, overkill for POC
  throughput_mode  = "bursting"       # default; flip to "elastic" if Postgres feels slow

  tags = { Name = "${var.app_name}-pgdata" }
}

# One mount target per AZ. ECS may place the task in either subnet; both
# need a mount target for the EFS volume to be reachable.
resource "aws_efs_mount_target" "pgdata" {
  for_each        = toset(local.platform.public_subnet_ids)
  file_system_id  = aws_efs_file_system.pgdata.id
  subnet_id       = each.key
  security_groups = [aws_security_group.efs.id]
}

# Access point pins ownership to UID/GID 999 (the postgres user inside
# postgres:17-alpine) so the container starts cleanly. Root directory
# /pgdata is created with 0700 perms owned by 999:999.
resource "aws_efs_access_point" "pgdata" {
  file_system_id = aws_efs_file_system.pgdata.id

  posix_user {
    uid = 999
    gid = 999
  }

  root_directory {
    path = "/pgdata"
    creation_info {
      owner_uid   = 999
      owner_gid   = 999
      permissions = "0700"
    }
  }
}
