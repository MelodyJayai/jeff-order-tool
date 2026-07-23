export function isCloudDeployment() {
  return process.env.JEFF_DEPLOYMENT_MODE?.trim().toLowerCase() === "cloud";
}

export function areInAppUpdatesDisabled() {
  return (
    isCloudDeployment() ||
    process.env.JEFF_DISABLE_IN_APP_UPDATES?.trim().toLowerCase() === "true"
  );
}

export function isReturnWorkflowEnabled() {
  return (
    process.env.JEFF_ENABLE_RETURN_WORKFLOW?.trim().toLowerCase() === "true"
  );
}
