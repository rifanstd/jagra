/** One line of View changes (AGT-19, AGT-20). */
export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** Above this many line pairs the comparison is skipped, so a huge file cannot freeze Jagra. */
const PAIR_LIMIT = 4_000_000;
/** Bytes looked at to tell text from binary, as git does. */
const SNIFF_BYTES = 8000;

/** Text when it holds no NUL byte near the start and reads as UTF-8. */
export function asText(bytes: Uint8Array | null): string | undefined {
  if (bytes === null) return "";
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The lines removed and added between two texts, in order, from their longest common
 * subsequence. Undefined when the files are too large to compare.
 */
export function lineDiff(
  before: string,
  after: string,
): DiffLine[] | undefined {
  const a = lines(before);
  const b = lines(after);
  // Lines both texts share at the start and end need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  if (midA.length * midB.length > PAIR_LIMIT) return undefined;

  // table[i][j]: the longest common subsequence of midA[i..] and midB[j..].
  const width = midB.length + 1;
  const table = new Uint32Array((midA.length + 1) * width);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i * width + j] =
        midA[i] === midB[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + j + 1] ?? 0,
            );
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: "same", text: midA[i] ?? "" });
      i++;
      j++;
    } else if (
      (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)
    ) {
      middle.push({ kind: "removed", text: midA[i] ?? "" });
      i++;
    } else {
      middle.push({ kind: "added", text: midB[j] ?? "" });
      j++;
    }
  }
  for (; i < midA.length; i++)
    middle.push({ kind: "removed", text: midA[i] ?? "" });
  for (; j < midB.length; j++)
    middle.push({ kind: "added", text: midB[j] ?? "" });

  return [
    ...a.slice(0, start).map((text) => ({ kind: "same" as const, text })),
    ...middle,
    ...a.slice(a.length - end).map((text) => ({ kind: "same" as const, text })),
  ];
}

function lines(text: string): string[] {
  if (text === "") return [];
  const split = text.split(/\r?\n/);
  if (split.at(-1) === "") split.pop();
  return split;
}
