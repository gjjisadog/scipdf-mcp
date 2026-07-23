import { describe, expect, it } from "vitest";
import { pickBestWork, titlesMatch } from "../src/core/crossref.js";

describe("titlesMatch", () => {
  it("does not accept a short generic substring as an exact title match", () => {
    expect(titlesMatch("Introduction", "Introduction to Feline Nutrition")).toBe(
      false,
    );
  });

  it("keeps substantial CJK title containment", () => {
    expect(titlesMatch("量子计算前沿进展", "量子计算前沿进展与应用")).toBe(true);
  });
});

describe("pickBestWork", () => {
  it("does not let a generic substring bypass the score threshold", () => {
    const works = [
      {
        doi: "10.1000/wrong",
        title: "Introduction to Feline Nutrition",
        score: 1,
      },
    ];
    expect(pickBestWork(works, 20, "Introduction")).toBeNull();
  });
});
