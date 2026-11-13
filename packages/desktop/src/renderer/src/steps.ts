import type { StepView } from "../../shared/api";

type T = (key: string, values?: Record<string, unknown>) => string;

const RELATIONS = [
  "below",
  "above",
  "leftOf",
  "rightOf",
  "childOf",
  "containsChild",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoted(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? `"${String(value)}"`
    : undefined;
}

/** A value written in the flow, as text; anything that is not a word or a number is left out. */
function plain(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** What a step points at, for example `"Save"` or `"Oat milk" below "Keep chilled"`. */
function target(args: unknown, t: T): string {
  const simple = quoted(args);
  if (simple) return simple;
  if (!isRecord(args)) return "";
  let text =
    quoted(args.text) ??
    (args.id !== undefined
      ? t("steps.id", { id: quoted(args.id) ?? "" })
      : undefined) ??
    (args.point !== undefined
      ? t("steps.point", { point: plain(args.point) })
      : undefined) ??
    "";
  for (const relation of RELATIONS) {
    const other = args[relation];
    if (other !== undefined)
      text += ` ${t(`steps.relation.${relation}`, { target: target(other, t) })}`;
  }
  return text.trim();
}

/**
 * A step in plain language (RES-4). core gives the Maestro command and its arguments as written
 * (D-32); text from the flow file is shown as text, never as HTML (SEC-7). A step with its own
 * `label` keeps it, as Maestro does.
 */
export function stepText(step: StepView, t: T): string {
  const { command, args } = step;
  if (isRecord(args) && typeof args.label === "string") return args.label;
  switch (command) {
    case "launchApp":
      return isRecord(args) && args.clearState === true
        ? t("steps.launchAppClean")
        : t("steps.launchApp");
    case "stopApp":
    case "killApp":
      return t("steps.stopApp");
    case "clearState":
      return t("steps.clearState");
    case "tapOn":
      return t("steps.tapOn", { target: target(args, t) });
    case "doubleTapOn":
      return t("steps.doubleTapOn", { target: target(args, t) });
    case "longPressOn":
      return t("steps.longPressOn", { target: target(args, t) });
    case "inputText":
      return t("steps.inputText", {
        text: quoted(isRecord(args) ? args.text : args) ?? "",
      });
    case "inputRandomText":
    case "inputRandomNumber":
    case "inputRandomEmail":
    case "inputRandomPersonName":
      return t("steps.inputRandom");
    case "eraseText":
      return t("steps.eraseText");
    case "pasteText":
      return t("steps.pasteText");
    case "copyTextFrom":
      return t("steps.copyTextFrom", { target: target(args, t) });
    case "hideKeyboard":
      return t("steps.hideKeyboard");
    case "back":
      return t("steps.back");
    case "pressKey":
      return t("steps.pressKey", { key: plain(args) });
    case "scroll":
      return t("steps.scroll");
    case "scrollUntilVisible":
      return t("steps.scrollUntilVisible", {
        target: target(isRecord(args) ? args.element : args, t),
      });
    case "swipe":
      return t("steps.swipe");
    case "assertVisible":
      return t("steps.assertVisible", { target: target(args, t) });
    case "assertNotVisible":
      return t("steps.assertNotVisible", { target: target(args, t) });
    case "assertTrue":
      return t("steps.assertTrue");
    case "extendedWaitUntil":
      if (isRecord(args) && args.visible !== undefined)
        return t("steps.waitVisible", { target: target(args.visible, t) });
      if (isRecord(args) && args.notVisible !== undefined)
        return t("steps.waitNotVisible", {
          target: target(args.notVisible, t),
        });
      return t("steps.wait");
    case "waitForAnimationToEnd":
      return t("steps.waitForAnimation");
    case "takeScreenshot":
      return t("steps.takeScreenshot");
    case "openLink":
      return t("steps.openLink", {
        link: plain(isRecord(args) ? args.link : args),
      });
    case "runFlow":
      return step.helper
        ? t("steps.runFlowFile", {
            file: step.helper.file,
            name: step.helper.name,
          })
        : t("steps.runFlow");
    case "runScript":
    case "evalScript":
      return t("steps.runScript");
    case "repeat":
      return isRecord(args) && args.times !== undefined
        ? t("steps.repeatTimes", { times: plain(args.times) })
        : t("steps.repeat");
    case "retry":
      return t("steps.retry");
    default:
      return command;
  }
}
