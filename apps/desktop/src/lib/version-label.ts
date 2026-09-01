const BETA_VERSION_PATTERN = /beta\.(\d+)/i;

export function compactVersionLabel(version: string) {
  const betaNumber = version.match(BETA_VERSION_PATTERN)?.[1];
  return betaNumber ? `Beta ${betaNumber}` : `v${version}`;
}
