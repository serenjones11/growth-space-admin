import { describe, it, expect } from "vitest";
import { fitWithin, thumbPathOf } from "./images";

describe("fitWithin", () => {
  it("scales the longest side down to the limit, keeping the shape", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 500)).toEqual({ width: 375, height: 500 });
  });
  it("never scales a small image up", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe("thumbPathOf", () => {
  it("puts the small copy next to the photo", () => {
    expect(thumbPathOf("photos/GC-01/1794234556478.jpg")).toBe("photos/GC-01/1794234556478-thumb.jpg");
    expect(thumbPathOf("photos/Tawny Owl/1.png")).toBe("photos/Tawny Owl/1-thumb.jpg");
    expect(thumbPathOf("photos/GC-01/noext")).toBe("photos/GC-01/noext-thumb.jpg");
    expect(thumbPathOf(null)).toBe(null);
  });
});
