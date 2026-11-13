import type { Device } from "@jagra/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StartAnswer } from "../../../shared/api";
import { describeError } from "../errors";
import type { Go } from "../navigation";
import { useLiveRun } from "../use-live-run";
import { Note } from "./note";
import { Status } from "./status";
import { TextLink } from "./text-link";
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

/** Devices a run can use as they are; an emulator that is off is started first (DEV-4). */
const USABLE = new Set<Device["state"]>([
  "emulator-running",
  "emulator-starting",
  "emulator-off",
  "phone-ready",
]);

/**
 * The Run button and what it may ask before a run starts: variable values (RUN-10) and a
 * different APK package (PRJ-6). Tools that stop the run are named with a link to the check (ENV-8).
 */
export function RunControls({
  projectId,
  chosen,
  device,
  ready,
  go,
  label,
  beforeStart,
}: {
  projectId: string;
  chosen: number;
  device?: Device;
  ready: boolean;
  go: Go;
  /** Replaces "Run N flows", as Run again does (RES-10). */
  label?: string;
  /** Runs first, for example to choose the flows of an earlier run. */
  beforeStart?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const live = useLiveRun();
  const active = live !== undefined && !live.finished;
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<StartAnswer>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [secretFailed, setSecretFailed] = useState(false);

  const start = async (acceptPackage = false) => {
    if (!device) return;
    setBusy(true);
    setAnswer(undefined);
    try {
      await beforeStart?.();
      const next = await window.jagra.runs.start({
        projectId,
        deviceId: device.id,
        acceptPackage,
      });
      if ("started" in next) go({ screen: "running" });
      else setAnswer(next);
    } finally {
      setBusy(false);
    }
  };

  const saveSecrets = async (names: string[]) => {
    setSecretFailed(false);
    try {
      for (const name of names)
        await window.jagra.secrets.set(projectId, name, values[name] ?? "");
    } catch {
      setSecretFailed(true);
      return;
    }
    setValues({});
    await start();
  };

  const disabled =
    active ||
    busy ||
    chosen === 0 ||
    !device ||
    !ready ||
    !USABLE.has(device.state);
  const secrets = answer && "secrets" in answer ? answer.secrets : undefined;
  const differs =
    answer && "packageDiffers" in answer ? answer.packageDiffers : undefined;

  return (
    <div className="grid gap-3">
      {active && (
        <Note tone="info" testId="run-active">
          <p>{t("project.run.active")}</p>
          <div>
            <TextLink onClick={() => go({ screen: "running" })}>
              {t("project.run.showRun")}
            </TextLink>
          </div>
        </Note>
      )}
      {answer && "tools" in answer && (
        <Note tone="failed" testId="run-blocked">
          <p>{t("project.run.toolsBlocked")}</p>
          <ul className="grid gap-1">
            {answer.tools.map((tool) => (
              <li key={tool.tool}>
                <Status tone="failed">
                  {t(
                    `env.indicator.${tool.state === "untested-version" || tool.state === "ready" ? "missing" : tool.state}`,
                    {
                      tool: t(`env.tool.${tool.tool}.name`),
                    },
                  )}
                </Status>
              </li>
            ))}
          </ul>
          <div>
            <TextLink onClick={() => go({ screen: "environment" })}>
              {t("project.device.openCheck")}
            </TextLink>
          </div>
        </Note>
      )}
      {answer && "error" in answer && (
        <Note tone="failed" testId="run-blocked">
          <p>{describeError(answer.error, t)}</p>
        </Note>
      )}
      {chosen === 0 && (
        <span className="text-sm text-muted-foreground">
          {t("project.run.noFlows")}
        </span>
      )}
      <Button size="lg" disabled={disabled} onClick={() => void start()}>
        {label ?? t("project.run.start", { count: chosen })}
      </Button>

      <Dialog
        open={secrets !== undefined}
        onOpenChange={(open) => !open && setAnswer(undefined)}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (secrets) void saveSecrets(secrets);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("dialogs.secrets.title")}</DialogTitle>
              <DialogDescription>{t("dialogs.secrets.text")}</DialogDescription>
            </DialogHeader>
            {secrets?.map((name) => (
              <div key={name} className="grid gap-1.5">
                <Label htmlFor={`secret-${name}`} className="font-mono">
                  {name}
                </Label>
                <Input
                  id={`secret-${name}`}
                  type="password"
                  autoComplete="off"
                  placeholder={t("dialogs.secrets.placeholder", { name })}
                  value={values[name] ?? ""}
                  onChange={(event) =>
                    setValues({ ...values, [name]: event.target.value })
                  }
                />
              </div>
            ))}
            <span className="text-sm text-muted-foreground">
              {t("dialogs.secrets.hint")}
            </span>
            {secretFailed && (
              <Note tone="failed">
                <p>{t("dialogs.secrets.failed")}</p>
              </Note>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAnswer(undefined)}
              >
                {t("dialogs.secrets.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={secrets?.some((name) => !values[name])}
              >
                {t("dialogs.secrets.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={differs !== undefined}
        onOpenChange={(open) => !open && setAnswer(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogs.package.title")}</DialogTitle>
            <DialogDescription>
              {differs && t("dialogs.package.text", differs)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnswer(undefined)}>
              {t("dialogs.package.cancel")}
            </Button>
            <Button onClick={() => void start(true)}>
              {t("dialogs.package.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
