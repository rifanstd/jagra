// Types the desktop renderer may use. They pull in no Node code, since the renderer has no Node
// (SEC-6). The renderer imports only from `@jagra/core/types`.
export type * from "./errors/index.js";
export type * from "./types/index.js";
export type { StepMark, StepMarkKind } from "./ports/flow-runner.js";
export type { CustomAgent, CustomAgentInput } from "./agents/custom.js";
export type { AgentProtocol, KnownAgentId } from "./agents/known.js";
export type { AgentReport } from "./agents/report.js";
export type { ChangeKind, Changes, FileChange } from "./safety/types.js";
export type { DiffLine } from "./safety/diff.js";
