import type { CustomAgent } from "@jagra/core";
import en from "../renderer/src/locales/en.json" with { type: "json" };
import id from "../renderer/src/locales/id.json" with { type: "json" };
import type { Language } from "../shared/api.js";

export interface ConfirmBox {
  type: "question";
  title: string;
  message: string;
  detail: string;
  buttons: [save: string, cancel: string];
  defaultId: 1;
  cancelId: 1;
  noLink: true;
}

/**
 * The system dialog that confirms a custom agent before it is saved (D-109). It shows the program
 * and each argument on its own line, exactly as Jagra will start them.
 */
export function confirmBox(agent: CustomAgent, language: Language): ConfirmBox {
  const text = (language === "id" ? id : en).agents.confirm;
  const lines = (label: string, command: readonly string[]) => {
    const [program = "", ...args] = command;
    return [
      label,
      `  ${text.program}: ${program}`,
      ...args.map((arg, index) => `  ${text.argument} ${index + 1}: ${arg}`),
    ];
  };
  const detail =
    agent.protocol === "acp"
      ? lines(text.acp, agent.command)
      : [
          ...lines(text.start, agent.start),
          ...(agent.continue
            ? ["", ...lines(text.continue, agent.continue)]
            : []),
        ];
  return {
    type: "question",
    title: text.title,
    message: text.message.replace("{{name}}", agent.name),
    detail: [...detail, "", text.note].join("\n"),
    buttons: [text.save, text.cancel],
    // Cancel is the default, so Enter never saves a command by accident.
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}
