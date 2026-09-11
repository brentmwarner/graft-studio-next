const { withDangerousMod } = require("@expo/config-plugins");
const { writeDebugCleartextManifest } = require("./debugCleartextManifest");

function withDebugCleartextTraffic(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      writeDebugCleartextManifest(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);
}

module.exports = withDebugCleartextTraffic;
