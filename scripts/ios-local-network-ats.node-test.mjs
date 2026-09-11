import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const infoPlistPath = join(repositoryRoot, "apps/ios/Graft/Resources/Info.plist");

function parsePlistDict(xml) {
  let index = 0;

  function skipWhitespace() {
    while (index < xml.length && /\s/.test(xml[index] ?? "")) index += 1;
  }

  function expectToken(token) {
    skipWhitespace();
    if (!xml.startsWith(token, index)) {
      throw new Error(`Expected ${token} at ${index}`);
    }
    index += token.length;
  }

  function parseValue() {
    skipWhitespace();
    if (xml.startsWith("<true/>", index)) {
      index += "<true/>".length;
      return true;
    }
    if (xml.startsWith("<false/>", index)) {
      index += "<false/>".length;
      return false;
    }
    if (xml.startsWith("<dict/>", index)) {
      index += "<dict/>".length;
      return {};
    }
    if (xml.startsWith("<array/>", index)) {
      index += "<array/>".length;
      return [];
    }
    if (xml.startsWith("<string>", index)) {
      const start = index + "<string>".length;
      const end = xml.indexOf("</string>", start);
      if (end < 0) throw new Error("Unterminated string");
      index = end + "</string>".length;
      return xml.slice(start, end);
    }
    if (xml.startsWith("<integer>", index)) {
      const start = index + "<integer>".length;
      const end = xml.indexOf("</integer>", start);
      if (end < 0) throw new Error("Unterminated integer");
      index = end + "</integer>".length;
      return Number(xml.slice(start, end));
    }
    if (xml.startsWith("<dict>", index)) {
      return parseDict();
    }
    if (xml.startsWith("<array>", index)) {
      return parseArray();
    }
    throw new Error(`Unsupported plist value at ${index}`);
  }

  function parseArray() {
    expectToken("<array>");
    const items = [];
    while (true) {
      skipWhitespace();
      if (xml.startsWith("</array>", index)) {
        index += "</array>".length;
        return items;
      }
      items.push(parseValue());
    }
  }

  function parseDict() {
    expectToken("<dict>");
    const dict = {};
    while (true) {
      skipWhitespace();
      if (xml.startsWith("</dict>", index)) {
        index += "</dict>".length;
        return dict;
      }
      expectToken("<key>");
      const keyEnd = xml.indexOf("</key>", index);
      if (keyEnd < 0) throw new Error("Unterminated key");
      const key = xml.slice(index, keyEnd);
      index = keyEnd + "</key>".length;
      dict[key] = parseValue();
    }
  }

  const start = xml.indexOf("<dict>");
  if (start < 0) throw new Error("Info.plist has no dict");
  index = start;
  return parseDict();
}

test("iOS ATS allows local-network HTTP pairing without a global cleartext exception", async () => {
  const xml = await readFile(infoPlistPath, "utf8");
  const root = parsePlistDict(xml);
  const ats = root.NSAppTransportSecurity;
  assert.equal(typeof ats, "object");
  assert.equal(ats.NSAllowsArbitraryLoads, undefined);
  assert.equal(ats.NSAllowsLocalNetworking, true);
  const tsNet = ats.NSExceptionDomains?.["ts.net"];
  assert.equal(tsNet?.NSIncludesSubdomains, true);
  assert.equal(tsNet?.NSExceptionAllowsInsecureHTTPLoads, true);
});
