// D-3 of the 2026-10-22 audit (CHANGELOG.md): the notch field of the Processing tab
// turns its text into notchFreqs with parseFrequencyInput and checks it with validateParameters
// (the live filter of the Inspection tab does the same). "59,5" used to become 59 and 5 Hz.

import { describe, expect, it } from "vitest";

import {
  hasDecimalComma,
  parseFrequencyInput,
  parseFrequencyList,
  validateParameters,
} from "@/services/parameters";
import { DEFAULT_PARAMETERS } from "@/services/types";

function notchErrors(text: string) {
  const notchFreqs = parseFrequencyInput(text);
  return validateParameters({ ...DEFAULT_PARAMETERS, notch: true, notchFreqs });
}

describe("D-3: a decimal comma in the notch field is not split into two notches", () => {
  it.each(["59,5", "60,29"])("refuses %s and asks for a dot", (text) => {
    expect(parseFrequencyInput(text)).not.toEqual(text.split(",").map(Number));
    expect(notchErrors(text)).toContain("frequências de notch devem ser números positivos");
    expect(hasDecimalComma(text)).toBe(true);
  });

  it.each([
    ["60", [60]],
    ["59.5", [59.5]],
    ["60, 29", [60, 29]],
    ["60;29", [60, 29]],
    ["60 29", [60, 29]],
    [" 60 ;  29.5 ", [60, 29.5]],
  ])("reads %j as %j", (text, expected) => {
    expect(parseFrequencyInput(text)).toEqual(expected);
    expect(notchErrors(text)).toEqual([]);
    expect(hasDecimalComma(text)).toBe(false);
  });

  it("keeps the internal '60,29' format used by the API and saved jobs", () => {
    expect(parseFrequencyList("60,29")).toEqual([60, 29]);
  });
});
