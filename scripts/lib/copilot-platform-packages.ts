/** Native Copilot executables must be staged alongside the bundled SDK. */
export function resolveBundledCopilotPlatformPackages(
  platform: "mac" | "linux" | "win",
  arch: "arm64" | "x64" | "universal",
): ReadonlyArray<string> {
  if (platform === "mac") {
    if (arch === "universal") {
      return ["@github/copilot-darwin-arm64", "@github/copilot-darwin-x64"];
    }
    return [arch === "arm64" ? "@github/copilot-darwin-arm64" : "@github/copilot-darwin-x64"];
  }
  if (platform === "linux") {
    return [arch === "arm64" ? "@github/copilot-linux-arm64" : "@github/copilot-linux-x64"];
  }
  return [arch === "arm64" ? "@github/copilot-win32-arm64" : "@github/copilot-win32-x64"];
}
