// Types the renderer may use as well; this file pulls in no Node code (SEC-6).

export type ChangeKind = "created" | "changed" | "deleted";

export interface FileChange {
  /** Relative to the project folder, or to `.jagra/flows` for flows, with `/`. */
  path: string;
  kind: ChangeKind;
}

export interface Changes {
  /** Files outside `.jagra/flows` the agent created, changed or deleted (AGT-19). */
  outside: FileChange[];
  /** Flows other than the requested one (AGT-20). */
  flows: FileChange[];
}
