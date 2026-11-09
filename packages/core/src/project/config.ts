import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isNode, LineCounter, parseDocument, type Document } from "yaml";
import { z } from "zod";
import { fail, ok, type Result } from "../errors/index.js";
import { SUPPORTED_FORMAT } from "./format.js";

export const DEFAULT_APK_SEARCH_PATH = "app/build/outputs/apk/debug";
export const DEFAULT_FLOW_TIMEOUT_MINUTES = 5;

// Every field except `format` has a default, and unknown fields are kept so a newer Jagra can add
// fields without breaking an older one (docs/architecture.md section 3).
const configSchema = z.looseObject({
  format: z.literal(SUPPORTED_FORMAT),
  name: z.string().min(1).optional(),
  appId: z
    .string()
    .nullish()
    .transform((id) => id ?? ""),
  apk: z
    .looseObject({
      searchPath: z.string().min(1).default(DEFAULT_APK_SEARCH_PATH),
    })
    .prefault({}),
  mockoon: z
    .looseObject({
      file: z.string().min(1),
      port: z.int().min(1).max(65535).optional(),
    })
    .nullish()
    .transform((block) => block ?? undefined),
  run: z
    .looseObject({
      flowTimeoutMinutes: z
        .number()
        .positive()
        .default(DEFAULT_FLOW_TIMEOUT_MINUTES),
    })
    .prefault({}),
});

// An intersection rather than Omit: Omit on a loose object keeps only its index signature.
export type ProjectConfig = z.infer<typeof configSchema> & { name: string };

export function configFile(projectFolder: string): string {
  return join(projectFolder, ".jagra", "config.yaml");
}

export async function loadConfig(
  projectFolder: string,
): Promise<Result<ProjectConfig>> {
  const file = configFile(projectFolder);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    return error.code === "ENOENT"
      ? fail({ code: "FILE_NOT_FOUND", file })
      : fail({ code: "FILE_READ_FAILED", file, detail: error.message });
  }
  return parseConfig(text, file, basename(projectFolder));
}

/** Reads `config.yaml` text. `folderName` is the default project name (PRJ-2). */
export function parseConfig(
  text: string,
  file: string,
  folderName: string,
): Result<ProjectConfig> {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  const yamlError = doc.errors[0];
  if (yamlError) {
    const at = yamlError.linePos?.[0] ?? { line: 1, col: 1 };
    return fail({
      code: "CONFIG_YAML_INVALID",
      file,
      line: at.line,
      column: at.col,
      detail: yamlError.message.split("\n")[0] ?? yamlError.code,
    });
  }

  const raw: unknown = doc.toJS();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail({ code: "CONFIG_NOT_A_MAP", file });
  }

  // `format` comes first: a newer format may change any other field (PRJ-9).
  const format = (raw as Record<string, unknown>).format;
  if (format === undefined || format === null)
    return fail({ code: "CONFIG_FORMAT_MISSING", file });
  if (
    typeof format === "number" &&
    Number.isInteger(format) &&
    format > SUPPORTED_FORMAT
  ) {
    return fail({
      code: "CONFIG_FORMAT_UNSUPPORTED",
      file,
      found: format,
      supported: SUPPORTED_FORMAT,
    });
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String) ?? [];
    const at = locate(doc, lines, path);
    return fail({
      code: "CONFIG_FIELD_INVALID",
      file,
      field: path.join("."),
      line: at.line,
      column: at.col,
      detail: issue?.message ?? "invalid",
    });
  }
  return ok({ ...parsed.data, name: parsed.data.name ?? folderName });
}

/** Line and column of the node at `path`, or of its closest parent block when the field is missing. */
function locate(
  doc: Document,
  lines: LineCounter,
  path: string[],
): { line: number; col: number } {
  for (let depth = path.length; depth > 0; depth--) {
    const node: unknown = doc.getIn(path.slice(0, depth), true);
    if (isNode(node) && node.range) return lines.linePos(node.range[0]);
  }
  return { line: 1, col: 1 };
}
