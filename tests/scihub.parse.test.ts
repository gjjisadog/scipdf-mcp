import { describe, expect, it } from "vitest";
import { extractPdfUrlFromHtml } from "../src/core/scihub.js";

describe("extractPdfUrlFromHtml", () => {
  it("reads #pdf src (absolute)", () => {
    const html = `<html><body><iframe id="pdf" src="https://cdn.example.com/paper.pdf"></iframe></body></html>`;
    expect(extractPdfUrlFromHtml(html, "https://sci-hub.se/10.1/x")).toBe(
      "https://cdn.example.com/paper.pdf",
    );
  });

  it("resolves protocol-relative src", () => {
    const html = `<html><body><embed id="pdf" src="//sci-hub.se/downloads/2020/paper.pdf"></embed></body></html>`;
    const url = extractPdfUrlFromHtml(html, "https://sci-hub.se/10.1/x");
    expect(url).toBe("https://sci-hub.se/downloads/2020/paper.pdf");
  });

  it("resolves root-relative src", () => {
    const html = `<html><body><div id="pdf" src="/downloads/x.pdf"></div></body></html>`;
    const url = extractPdfUrlFromHtml(html, "https://sci-hub.se/10.1/x");
    expect(url).toBe("https://sci-hub.se/downloads/x.pdf");
  });

  it("returns null when missing", () => {
    const html = `<html><body><p>not found</p></body></html>`;
    expect(extractPdfUrlFromHtml(html, "https://sci-hub.se/10.1/x")).toBeNull();
  });
});
