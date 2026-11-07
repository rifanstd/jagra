import type { ToolFiles } from "../adapters/tools/files.js";

/** A described file system: files with optional text, folders, and symbolic links. */
export class FakeToolFiles implements ToolFiles {
  private readonly files = new Map<string, string>();
  private readonly folders = new Set<string>();
  private readonly links = new Map<string, string>();

  file(path: string, text = ""): this {
    this.files.set(path, text);
    return this;
  }

  folder(path: string): this {
    this.folders.add(path);
    return this;
  }

  link(path: string, target: string): this {
    this.links.set(path, target);
    this.files.set(path, "");
    return this;
  }

  isFile(path: string): boolean {
    return this.files.has(path);
  }

  isFolder(path: string): boolean {
    return this.folders.has(path);
  }

  readText(path: string): string | undefined {
    return this.files.get(path);
  }

  realPath(path: string): string {
    return this.links.get(path) ?? path;
  }
}
