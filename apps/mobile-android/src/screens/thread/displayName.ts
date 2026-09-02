export function displayName(value: string): string {
  if (value === "xhigh") return "Extra High";
  if (value === "none" || value === "off") return "Off";
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
