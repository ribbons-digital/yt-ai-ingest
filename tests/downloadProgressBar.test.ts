import { describe, expect, it } from "vitest";
import { createDownloadProgressBar } from "../src/lib/ui.js";

describe("createDownloadProgressBar", () => {
  it("uses cli-progress style lifecycle methods", () => {
    const progress = createDownloadProgressBar("Downloading video assets...", {
      enabled: false
    });

    expect(progress.start).toBeTypeOf("function");
    expect(progress.update).toBeTypeOf("function");
    expect(progress.stop).toBeTypeOf("function");
  });
});
