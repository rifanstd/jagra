import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Language, Settings, SettingsView } from "../shared/api.js";

export const settingsSchema = z.strictObject({
  language: z.enum(["en", "id"]).optional(),
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
  update(change: Settings): Promise<SettingsView> {
    const next = this.queue.then(async () => {
      const merged: Settings = { ...(await this.read()), ...change };
      if (merged.language === undefined) delete merged.language;
      await this.write(merged);
      return this.view();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Settings> {
    try {
      const parsed = settingsSchema.safeParse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
      // A broken file gives the defaults rather than stopping the app (REL-6).
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private async write(settings: Settings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temp, this.file);
  }
}
