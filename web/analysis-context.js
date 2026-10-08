// An asynchronous result must never be attributed to a different buyer/profile.
export function captureAnalysisContext(profile, revision) {
  return { profileSnapshot: JSON.stringify(profile), revision };
}
export function analysisContextIsCurrent(context, profile, revision) {
  return context.revision === revision && context.profileSnapshot === JSON.stringify(profile);
}
