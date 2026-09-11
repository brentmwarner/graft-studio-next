const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const DEBUG_CLEARTEXT_ANDROID_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application android:usesCleartextTraffic="true" tools:targetApi="28" />
</manifest>
`;

function debugCleartextManifestPath(androidRoot) {
  return join(androidRoot, "app/src/debug/AndroidManifest.xml");
}

function writeDebugCleartextManifest(androidRoot) {
  const destination = debugCleartextManifestPath(androidRoot);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, DEBUG_CLEARTEXT_ANDROID_MANIFEST);
  return destination;
}

module.exports = {
  DEBUG_CLEARTEXT_ANDROID_MANIFEST,
  debugCleartextManifestPath,
  writeDebugCleartextManifest,
};
