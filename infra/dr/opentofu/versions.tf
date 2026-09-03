terraform {
  required_version = ">= 1.9.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.23.0"
    }
    tailscale = {
      source  = "tailscale/tailscale"
      version = "= 0.29.2"
    }
    betteruptime = {
      source  = "BetterStackHQ/better-uptime"
      version = "= 0.21.13"
    }
  }
}

provider "cloudflare" {}
provider "tailscale" {}
provider "betteruptime" {}
