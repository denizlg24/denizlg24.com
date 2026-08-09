/**
 * Shared with apps/forge, which renders the same deployments from the same
 * API. Kept as a re-export so this app's existing import path stays the one
 * everything here uses.
 */
export {
  DeploymentBadges,
  DeploymentCurrentBadge,
  DeploymentKindBadge,
  deploymentLabel,
  deploymentTone,
  domainTone,
  isDeploymentCurrent,
  isDeploymentLive,
  isDeploymentRetryable,
} from "@repo/cloud-ui/deploy-status";
