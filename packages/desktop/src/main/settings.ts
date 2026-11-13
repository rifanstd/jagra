import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Language, SettingsView, StoredSettings } from "../shared/api.js";

/** What the page may change (SEC-6). Paths are only ever set by main, from a system dialog. */
export const settingsSchema = z.strictObject({
  language: z.enum(["en", "id"]).optional(),
  environmentSeen: z.boolean().optional(),
});

const TOOLS = ["java", "adb", "maestro", "emulator", "mockoon"] as const;

/** Everything `settings.json` holds. */
const storedSchema = settingsSchema.extend({
  /** ENV-6: paths set by hand, which win over detection. */
  toolPaths: z.partialRecord(z.enum(TOOLS), z.string().min(1)).optional(),
  /** FLOW-5: the program that opens flow files instead of the system's default app. */
  editor: z.string().min(1).optional(),
});

/**
 * LNG-1: Indonesian when the operating system's first preferred language is Indonesian, English
 * otherwise. `id` and its old code `in` both count.
 */
export function systemLanguage(preferred: readonly string[]): Language {
  const first = (preferred[0] ?? "").toLowerCase();
  return /^(id|in)(-|_|$)/.test(first) ? "id" : "en";
}

/** `settings.json` in Jagra's local data folder (architecture.md section 4). */
export class SettingsFile {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    appData: string,
    private readonly preferredLanguages: () => readonly string[],
  ) {
    this.file = join(appData, "settings.json");
  }

  async view(): Promise<SettingsView> {
    const settings = await this.read();
    return {
      settings,
      language: settings.language ?? systemLanguage(this.preferredLanguages()),
    };
  }

  /** Applies a change and returns the result. `undefined` in a field clears it. */
  update(change: StoredSettings): Promise<SettingsView> {
    const next = this.queue.then(async () => {
      const merged: StoredSettings = { ...(await this.read()), ...change };
      for (const key of Object.keys(merged) as (keyof StoredSettings)[]) {
        if (merged[key] === undefined) delete merged[key];
      }
      await this.write(merged);
      return this.view();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<StoredSettings> {
    try {
      const parsed = storedSchema.safeParse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
      // A broken file gives the defaults rather than stopping the app (REL-6).
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private async write(settings: StoredSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temp, this.file);
  }
}
