resource "cloudflare_zero_trust_tunnel_cloudflared_config" "dr" {
  account_id = var.cloudflare_account_id
  tunnel_id  = var.dr_tunnel_id
  config = {
    ingress = concat(
      [for item in var.dr_tunnel_ingress : {
        hostname       = item.hostname
        service        = item.service
        origin_request = item.origin_host_header == null ? null : { http_host_header = item.origin_host_header }
      }],
      [{ service = "http_status:503" }]
    )
  }
}

# These hostnames always target the otherwise-idle DR tunnel. They are not
# production aliases: cutover uses them to prove an external edge-to-target
# request before any user-facing record changes.
resource "cloudflare_dns_record" "dr_probe" {
  for_each = var.dr_probe_records
  zone_id  = var.cloudflare_zone_id
  name     = each.value
  type     = "CNAME"
  content  = "${var.dr_tunnel_id}.cfargotunnel.com"
  ttl      = 1
  proxied  = true
  comment  = "Permanent disaster-recovery pre-cutover probe"
}

# Import the current records before apply. Direct database records stay at 60s
# continuously; recovery never relies on lowering an already-cached TTL.
resource "cloudflare_dns_record" "managed" {
  for_each = var.managed_records
  zone_id  = var.cloudflare_zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  ttl      = each.value.ttl
  proxied  = each.value.proxied
  comment  = "Managed by infra/dr; active-site fence applies"

  # Home DDNS and reviewed DR cutover own the live destination. OpenTofu owns
  # record existence/type/TTL but must never reclaim traffic during an outage.
  lifecycle { ignore_changes = [content] }
}

resource "cloudflare_dns_record" "active_site" {
  for_each = var.active_site_records
  zone_id  = var.cloudflare_zone_id
  name     = each.value
  type     = "TXT"
  content  = "home"
  ttl      = 60
  proxied  = false
  comment  = "${each.key} writable-site lease; home automation must act only while value is home"

  # Cutover owns this value operationally. A routine OpenTofu apply must never
  # turn a DR fence back into "home" while the original host is unavailable.
  lifecycle { ignore_changes = [content] }
}

# Import the existing policy before the first apply. Refusing an implicit
# overwrite makes console drift a reviewed recovery decision.
resource "tailscale_acl" "reviewed" {
  acl                        = file("${path.module}/../../tailscale/policy.hujson")
  overwrite_existing_content = false
}

data "betteruptime_severity" "high" {
  name = "High Severity"
}

resource "betteruptime_policy" "disaster_recovery" {
  name         = "Disaster recovery paging"
  repeat_count = 3
  repeat_delay = 60

  steps {
    type        = "escalation"
    wait_before = 0
    urgency_id  = data.betteruptime_severity.high.id
    step_members { type = "entire_team" }
  }
}

resource "betteruptime_monitor_group" "disaster_recovery" {
  name = "Disaster recovery public services"
}

resource "betteruptime_heartbeat_group" "disaster_recovery" {
  name = "Disaster recovery hosts and backups"
}

resource "betteruptime_monitor" "public" {
  for_each             = var.public_monitors
  url                  = each.value.url
  monitor_type         = each.value.keyword == null ? "status" : "keyword"
  required_keyword     = each.value.keyword
  check_frequency      = 180
  confirmation_period  = 0
  recovery_period      = 180
  request_timeout      = 15
  email                = true
  push                 = true
  critical_alert       = true
  policy_id            = betteruptime_policy.disaster_recovery.id
  monitor_group_id     = betteruptime_monitor_group.disaster_recovery.id
  maintenance_days     = var.maintenance_window.days
  maintenance_from     = var.maintenance_window.from
  maintenance_to       = var.maintenance_window.to
  maintenance_timezone = var.maintenance_window.timezone
  request_headers = each.key == "deep_dependency" ? [
    { name = "X-DR-Synthetic-Token", value = var.synthetic_monitor_token }
  ] : []
}

locals {
  heartbeats = {
    pi_host         = { period = 300, grace = 240 }
    forge_host      = { period = 300, grace = 240 }
    pi_backup       = { period = 21600, grace = 900 }
    forge_backup    = { period = 21600, grace = 900 }
    external_export = { period = 86400, grace = 3600 }
    icloud_warning  = { period = 3600, grace = 39600 }
    icloud_critical = { period = 3600, grace = 82800 }
    weekly_test     = { period = 604800, grace = 3600 }
  }
}

resource "betteruptime_heartbeat" "dr" {
  for_each             = local.heartbeats
  name                 = "DR ${replace(each.key, "_", " ")}"
  period               = each.value.period
  grace                = each.value.grace
  email                = true
  push                 = true
  critical_alert       = true
  policy_id            = betteruptime_policy.disaster_recovery.id
  heartbeat_group_id   = betteruptime_heartbeat_group.disaster_recovery.id
  maintenance_days     = var.maintenance_window.days
  maintenance_from     = var.maintenance_window.from
  maintenance_to       = var.maintenance_window.to
  maintenance_timezone = var.maintenance_window.timezone
  server_timezone      = each.value.period >= 3600 ? "Europe/Copenhagen" : null
}

output "heartbeat_urls" {
  value     = { for name, heartbeat in betteruptime_heartbeat.dr : name => heartbeat.url }
  sensitive = true
}

output "backup_failure_urls" {
  value = {
    for name, heartbeat in betteruptime_heartbeat.dr : name => "${heartbeat.url}/fail"
    if name == "pi_backup" || name == "forge_backup"
  }
  sensitive = true
}
