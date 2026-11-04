// Two reviews agree when their normalised texts are equal. The rule is that of
// notes/caefisica.com/sources/transcribe.py: style commands, spacing, braces
// and `$` do not count as a difference.
const NOISE = [
  "\\operatorname", "\\left", "\\right", "\\displaystyle", "\\mathrm", "\\text",
  "\\,", "\;", "\\!", "\\quad", "\\qquad",
];

export function normalise(text: string): string {
  let out = text;
  for (const noise of NOISE) out = out.split(noise).join("");
  return out.replace(/[\s{}$&]+/g, "");
}

export const sameText = (a: string, b: string) => normalise(a) === normalise(b);
