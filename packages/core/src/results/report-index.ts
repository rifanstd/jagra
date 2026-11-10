import type {
  FailureKind,
  FlowStatus,
  Run,
  RunStatus,
} from "../types/index.js";

/**
 * Words for the report index. core writes no sentences (D-20), so the CLI and the desktop app pass
 * them in, in the user's language.
 */
export interface ReportText {
  title: string;
  flow: string;
  status: string;
  duration: string;
  reason: string;
  apk: string;
  device: string;
  started: string;
  /** Link text to Maestro's report for one flow. */
  openReport: string;
  runStatus: Record<RunStatus, string>;
  flowStatus: Record<FlowStatus, string>;
  failure: Record<FailureKind, string>;
}

/** Icons beside the status word, never color alone (design/system/README.md). */
const ICONS: Record<FlowStatus, string> = {
  passed: "✓",
  failed: "✕",
  cancelled: "⊘",
  "not-run": "–",
  waiting: "…",
  running: "…",
};

/**
 * The small page that lists every flow with its status and links to Maestro's report for that flow
 * (RES-6). Every outside text is escaped (SEC-7). No styles or scripts from anywhere else (SEC-2).
 */
export function reportIndex(run: Run, text: ReportText, locale = "en"): string {
  const rows = run.flows
    .map((flow) => {
      const reason =
        flow.status === "failed" && flow.failure
          ? [text.failure[flow.failure], flow.reason].filter(Boolean).join(": ")
          : "";
      const link = flow.report
        ? `<a href="${escape(encodeURI(flow.report.replaceAll("\\", "/")))}">${escape(text.openReport)}</a>`
        : "";
      return `<tr>
<td>${escape(flow.name)}</td>
<td><span aria-hidden="true">${ICONS[flow.status]}</span> ${escape(text.flowStatus[flow.status])}</td>
<td>${flow.durationMs === undefined ? "" : escape(seconds(flow.durationMs))}</td>
<td>${escape(reason)}</td>
<td>${link}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${escape(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(text.title)}</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0 auto; padding: 24px 16px; max-width: 960px; line-height: 1.5; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
dt { font-weight: 600; }
dd { margin: 0; overflow-wrap: anywhere; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid GrayText; vertical-align: top; }
</style>
</head>
<body>
<h1>${escape(text.title)}</h1>
<dl>
<dt>${escape(text.status)}</dt><dd>${escape(text.runStatus[run.status])}</dd>
<dt>${escape(text.apk)}</dt><dd>${escape(`${basename(run.apk.file)} ${run.apk.versionName} (${run.apk.versionCode})`)}</dd>
<dt>${escape(text.device)}</dt><dd>${escape([run.device.name, run.device.androidVersion].filter(Boolean).join(", "))}</dd>
<dt>${escape(text.started)}</dt><dd>${escape(run.startedAt)}</dd>
</dl>
<div class="table">
<table>
<thead><tr><th>${escape(text.flow)}</th><th>${escape(text.status)}</th><th>${escape(text.duration)}</th><th>${escape(text.reason)}</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</body>
</html>
`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
