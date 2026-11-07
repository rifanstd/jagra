export const MASK = "***";

/** Replaces every known secret value with MASK, including values inside longer strings (SEC-4). */
export class Masker {
  // Longest first, so a secret that contains a shorter one is masked whole.
  private secrets: string[] = [];

  add(value: string): void {
    if (value === "" || this.secrets.includes(value)) return;
    this.secrets = [...this.secrets, value].sort((a, b) => b.length - a.length);
  }

  remove(value: string): void {
    this.secrets = this.secrets.filter((s) => s !== value);
  }

  mask(text: string): string {
    let masked = text;
    for (const secret of this.secrets) masked = masked.split(secret).join(MASK);
    return masked;
  }

  /** Masks every string inside a JSON-like value, keys included. */
  maskDeep(value: unknown): unknown {
    if (typeof value === "string") return this.mask(value);
    if (Array.isArray(value)) return value.map((item) => this.maskDeep(item));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          this.mask(key),
          this.maskDeep(item),
        ]),
      );
    }
    return value;
  }
}
