import type { JagraError } from "@jagra/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentsView } from "../../../shared/api";
import { describeError } from "../errors";
import { Note } from "./note";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * AGT-2, AGT-3: a name and a command. Main splits the command and asks in a system dialog before
 * saving it (D-109), so cancelling there leaves this form open.
 */
export function AddAgentDialog({
  protocol,
  onClose,
}: {
  /** Which form is open, or undefined when closed. */
  protocol: "acp" | "cli" | undefined;
  onClose: (view?: AgentsView) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<JagraError>();
  const [busy, setBusy] = useState(false);

  const close = (view?: AgentsView) => {
    setName("");
    setCommand("");
    setNext("");
    setError(undefined);
    onClose(view);
  };

  const save = async () => {
    if (!protocol) return;
    setBusy(true);
    const result = await window.jagra.agents.addCustom(
      protocol === "acp"
        ? { name: name.trim(), protocol, command: command.trim() }
        : {
            name: name.trim(),
            protocol,
            start: command.trim(),
            ...(next.trim() ? { continue: next.trim() } : {}),
          },
    );
    setBusy(false);
    if (!result) return;
    if (result.ok) close(result.value);
    else setError(result.error);
  };

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError(undefined);
  };
  const ready = name.trim() !== "" && command.trim() !== "" && !busy;

  return (
    <Dialog
      open={protocol !== undefined}
      onOpenChange={(open) => !open && close()}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                protocol === "acp"
                  ? "agents.form.acpTitle"
                  : "agents.form.commandTitle",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                protocol === "acp"
                  ? "agents.form.acpDescription"
                  : "agents.form.commandDescription",
              )}
            </DialogDescription>
          </DialogHeader>
          <Field
            id="agent-name"
            label={t("agents.form.name")}
            value={name}
            onChange={edit(setName)}
            maxLength={60}
          />
          <Field
            id="agent-command"
            label={t(
              protocol === "acp"
                ? "agents.form.acpCommand"
                : "agents.form.start",
            )}
            hint={t(
              protocol === "acp"
                ? "agents.form.acpHint"
                : "agents.form.startHint",
            )}
            value={command}
            onChange={edit(setCommand)}
            mono
          />
          {protocol === "cli" && (
            <Field
              id="agent-continue"
              label={t("agents.form.continue")}
              hint={t("agents.form.continueHint")}
              value={next}
              onChange={edit(setNext)}
              mono
            />
          )}
          {error && (
            <Note tone="failed">
              <p>{describeError(error, t)}</p>
            </Note>
          )}
          <p className="text-sm text-muted-foreground">
            {t("agents.form.confirmNote")}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close()}>
              {t("agents.form.cancel")}
            </Button>
            <Button type="submit" disabled={!ready}>
              {t("agents.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  maxLength = 2000,
  mono = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        spellCheck={false}
        autoComplete="off"
        className={mono ? "font-mono" : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
