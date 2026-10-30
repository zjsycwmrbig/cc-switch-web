import { describe, expect, it } from "vitest";
import { getUsageRemainingPercent } from "@/components/providers/ProviderList";

describe("Provider market usage percentage", () => {
  it("computes the progress from remaining and total for non-percent units", () => {
    expect(
      getUsageRemainingPercent({
        remaining: 12.5,
        total: 25,
        unit: "USD",
      }),
    ).toBe(50);
  });

  it("uses the remaining percentage directly for percent usage", () => {
    expect(
      getUsageRemainingPercent({
        remaining: 72.5,
        total: 100,
        unit: "%",
      }),
    ).toBe(72.5);
  });

  it("does not invent a percentage when no total is available", () => {
    expect(
      getUsageRemainingPercent({
        remaining: 12.5,
        unit: "USD",
      }),
    ).toBeNull();
  });
});
