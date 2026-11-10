import { describe, expect, it } from "vitest";
import type { Run } from "../types/index.js";
import { reportIndex, type ReportText } from "./report-index.js";

const TEXT: ReportText = {
  title: "Jagra report",
  flow: "Flow",
  status: "Status",
  duration: "Duration",
  reason: "Reason",
  apk: "APK",
  device: "Device",
  started: "Started",
  openReport: "Maestro report",
  runStatus: {
    running: "Running",
    completed: "Completed",
    cancelled: "Cancelled",
    stopped: "Stopped",
    interrupted: "Interrupted",
  },
  flowStatus: {
    waiting: "Waiting",
    running: "Running",
    passed: "Passed",
    failed: "Failed",
    cancelled: "Cancelled",
    "not-run": "Not run",
  },
  failure: {
    step: "Step failed",
    "timed-out": "Timed out",
    "app-crashed": "App crashed",
    "app-not-responding": "App not responding",
    "device-disconnected": "Device disconnected",
    error: "Error",
  },
};

const RUN: Run = {
  id: "20261110-183000-123-8000",
  projectId: "p1",
  status: "completed",
  startedAt: "2026-11-10T18:30:00.123Z",
  apk: {
    file: "/apk/app-debug.apk",
    packageName: "dev.jagra.sample",
    versionName: "1.0",
    versionCode: 1,
    modifiedAt: 0,
  },
  device: {
    id: "emulator-5554",
    name: "Pixel_8",
    kind: "emulator",
    androidVersion: "15",
  },
  flows: [
    {
      file: "/f/a.yaml",
      name: "Opening <b>an</b> item",
      status: "passed",
      durationMs: 12_345,
      report: "flows/01-a/report.html",
    },
    {
      file: "/f/b.yaml",
      name: "Saving",
      status: "failed",
      failure: "step",
      reason: 'Element not found: "Save" <script>alert(1)</script>',
      // Windows separators, as path.relative gives them there.
      report: "flows\\02-b b\\report.html",
    },
    { file: "/f/c.yaml", name: "Never ran", status: "not-run" },
  ],
  pid: 1,
};

describe("reportIndex (RES-6)", () => {
  const html = reportIndex(RUN, TEXT);

  it("lists every flow with an icon and a word, and links to Maestro's report", () => {
    expect(html).toContain("✓</span> Passed");
    expect(html).toContain("✕</span> Failed");
    expect(html).toContain("–</span> Not run");
    expect(html).toContain(
      '<a href="flows/01-a/report.html">Maestro report</a>',
    );
    expect(html).toContain('<a href="flows/02-b%20b/report.html">');
    expect(html).toContain("12.3 s");
    expect(html).toContain("app-debug.apk 1.0 (1)");
    expect(html).toContain("Pixel_8, 15");
  });

  it("shows outside text as text (SEC-7)", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>an</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Step failed: Element not found: &quot;Save&quot;");
  });

  it("loads nothing from outside (SEC-2)", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
  });
});
