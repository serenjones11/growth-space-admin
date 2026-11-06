import { describe, it, expect } from "vitest";
import { summariseUsage, buildUsageChartSvg, usageHeadline } from "./usageReport";

const monthLabels = ["Jan 26", "Feb 26", "Mar 26"];
const series = [
  { name: "Okafor", color: "#E69F00", values: [1, 2, 3] },
  { name: "Chen", color: "#56B4E9", values: [0, 1, 0] },
];

describe("summariseUsage", () => {
  it("works out average, peak, peak month and share per group", () => {
    const { rows, totals, allUnitMonths } = summariseUsage({ monthLabels, series, current: { Okafor: 3, Chen: 0 } });
    expect(totals).toEqual([1, 3, 3]);
    expect(allUnitMonths).toBe(7);
    expect(rows[0]).toMatchObject({ name: "Okafor", now: 3, average: 2, peak: 3, peakMonth: "Mar 26", unitMonths: 6, share: 86 });
    expect(rows[1]).toMatchObject({ name: "Chen", now: 0, average: 0.3, peak: 1, peakMonth: "Feb 26", share: 14 });
  });

  it("leaves 'now' empty when the range doesn't reach this month, and no peak month for an unused group", () => {
    const { rows } = summariseUsage({ monthLabels, series: [{ name: "Novak", color: "#000", values: [0, 0, 0] }] });
    expect(rows[0]).toMatchObject({ now: null, peak: 0, peakMonth: null, share: 0 });
  });
});

describe("buildUsageChartSvg", () => {
  it("draws one line per group with fixed colours and every month label", () => {
    const svg = buildUsageChartSvg({ monthLabels, series });
    expect(svg.match(/<polyline/g)).toHaveLength(2);
    expect(svg).toContain('stroke="#E69F00"');
    expect(svg).not.toContain("var(--");
    for (const m of monthLabels) expect(svg).toContain(`>${m}<`);
  });
});

describe("usageHeadline", () => {
  const row = (name, now, share = 0) => ({ name, now, share });
  it("names the group holding the most right now", () => {
    expect(usageHeadline([row("Okafor", 3), row("Chen", 1)], {}, 4)).toBe("Right now 4 units are held across 2 lab groups; the most by Okafor (3).");
  });
  it("says 'each' when every group holding space is tied", () => {
    expect(usageHeadline([row("Okafor", 1), row("Chen", 1), row("Novak", 0)], {}, 2)).toBe("Right now 2 units are held across 2 lab groups; 1 each.");
  });
  it("names all groups tied for the most", () => {
    expect(usageHeadline([row("Okafor", 2), row("Chen", 2), row("Novak", 1)], {}, 5)).toBe("Right now 5 units are held across 3 lab groups; the most by Okafor and Chen (2 each).");
  });
  it("uses share of space when the range doesn't include this month", () => {
    expect(usageHeadline([row("Okafor", null, 60), row("Chen", null, 40)], null, 10)).toBe("Over these months Okafor used the most space (60% of all unit-months).");
  });
});
