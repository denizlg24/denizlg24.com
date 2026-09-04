variable "cloudflare_account_id" { type = string }
variable "cloudflare_zone_id" { type = string }
variable "dr_tunnel_id" { type = string }
variable "active_site_records" { type = map(string) }
variable "dr_tunnel_ingress" {
  type = list(object({
    hostname           = string
    service            = string
    origin_host_header = optional(string)
  }))
}
variable "dr_probe_records" {
  type = set(string)
}
variable "managed_records" {
  type = map(object({ name = string, type = string, content = string, ttl = number, proxied = bool }))
}
variable "public_monitors" {
  type = map(object({ url = string, keyword = optional(string) }))
}
variable "maintenance_window" {
  type = object({
    days     = list(string)
    from     = string
    to       = string
    timezone = string
  })
  default = {
    days     = ["sun"]
    from     = "03:00:00"
    to       = "04:00:00"
    timezone = "Copenhagen"
  }
}
variable "synthetic_monitor_token" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.synthetic_monitor_token) >= 32
    error_message = "synthetic_monitor_token must contain at least 32 characters"
  }
}

# Better Stack refuses to create an escalation policy on the free plan: the
# POST comes back 403 "please upgrade your account". Every monitor and
# heartbeat below still alerts on its own email/push/critical_alert settings,
# so what an unset policy costs is the repeat and the escalation chain, not the
# alert. The DR plan says to use the free tier where it fits and to verify
# entitlements at implementation time; this is where it did not fit.
variable "escalation_policy_enabled" {
  type    = bool
  default = false
}
