#!/usr/bin/env bash
# Structured non-secret evidence; the status agent reads this prefix only.
dr_phase() {
  jq -cn --arg phase "$1" '{phase:$phase}' | sed 's/^/DR_STATUS /'
}

dr_metrics() {
  jq -c . | sed 's/^/DR_STATUS /'
}
