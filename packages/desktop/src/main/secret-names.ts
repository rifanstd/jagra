import { discoverFlows, type SecretStore } from "@jagra/core";
import type { SecretName } from "../shared/api.js";

/**
 * FLOW-7: every variable the project's flows and helper flows use, with whether it has a value,
 * plus stored values no flow uses any more, so they can be removed. Values never leave main.
 * Variables Maestro sets itself (`MAESTRO_*`) need no value.
 */
export async function secretNames(
  projectFolder: string,
  projectId: string,
  store: SecretStore,
): Promise<SecretName[]> {
  const list = await discoverFlows(projectFolder);
  const used = new Set(
    [...list.flows, ...list.helpers, ...list.others]
      .flatMap((flow) => flow.variables)
      .filter((name) => !name.startsWith("MAESTRO_")),
  );
  const stored = new Set(await store.listNames(projectId));
  return [...new Set([...used, ...stored])].sort().map((name) => ({
    name,
    hasValue: stored.has(name),
    used: used.has(name),
  }));
}
