/** The last part of a path from main, on Windows or macOS. The renderer has no Node `path`. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
