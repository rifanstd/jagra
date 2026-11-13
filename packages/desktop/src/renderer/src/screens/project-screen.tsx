import type { Device, Result } from "@jagra/core/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApkView,
  FlowView,
  HelperView,
  ProjectDetails,
  ProjectView,
} from "../../../shared/api";
import { Note } from "../components/note";
import { Status } from "../components/status";
import { TextLink } from "../components/text-link";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { describeError } from "../errors";
import { formatAgo, formatWhen } from "../format";
import type { Go } from "../navigation";
import { runLook } from "../run-look";
import { useDevices } from "../use-devices";

/** How often the APK is read again, so a new build shows without any action (PRJ-4, D-89). */
const APK_REFRESH_MS = 5000;

/** The phone checklist of core's PHONE_CHECKLIST, in order (DEV-6). */
const PHONE_CHECKLIST = [
  "usb-debugging",
  "accept-prompt",
  "screen-on-unlocked",
  "simulated-input",
] as const;

/** Screen 4: the flows to run, the APK, the device and Mockoon (PRJ-5, RUN-2, DEV, FLOW-3). */
export function ProjectScreen({ id, go }: { id: string; go: Go }) {
  const { t } = useTranslation();
  const [project, setProject] = useState<ProjectView | null>();

  const load = useCallback(async () => {
    setProject((await window.jagra.projects.get(id)) ?? null);
  }, [id]);

  useEffect(() => {
    void load();
    // Flows edited outside Jagra show when the user comes back (FLOW-6).
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  // The project was removed from the list in the meantime.
  useEffect(() => {
    if (project === null) go({ screen: "projects" });
  }, [project, go]);

  if (!project) return <main className="flex-1" />;

  const remove = async () => {
    await window.jagra.projects.remove(project.id);
    go({ screen: "projects" });
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p
            className="mt-1 truncate font-mono text-sm text-muted-foreground"
            title={project.folder}
          >
            {project.folder}
          </p>
        </div>
        <Button variant="ghost" onClick={() => void remove()}>
          {t("project.remove")}
        </Button>
      </div>
      {project.configError && (
        <Note tone="failed">
          <p>{describeError(project.configError, t)}</p>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.jagra.projects.openConfig(project.id)}
            >
              {t("projects.openFile")}
            </Button>
          </div>
        </Note>
      )}
      {project.details && (
        <ProjectBody id={project.id} details={project.details} go={go} />
      )}
    </main>
  );
}

function ProjectBody({
  id,
  details,
  go,
}: {
  id: string;
  details: ProjectDetails;
  go: Go;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-5">
        <Flows id={id} flows={details.flows} initial={details.chosen} />
        {details.helpers.length > 0 && (
          <Helpers id={id} helpers={details.helpers} />
        )}
      </div>
      <Card className="min-w-0 gap-0 py-0">
        <h2 className="px-5 pt-4 pb-3 font-semibold">
          {t("project.run.title")}
        </h2>
        <div className="grid gap-5 px-5 pb-5">
          <ApkField
            id={id}
            initial={details.apk}
            searchPath={details.searchPath}
          />
          <DeviceField id={id} saved={details.device} go={go} />
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">
              {t("project.run.mockoon")}
            </span>
            <MockoonLine mockoon={details.mockoon} />
          </div>
        </div>
        <div className="border-t px-5 py-3.5 text-sm" data-testid="last-run">
          <LastRunLine details={details} />
        </div>
      </Card>
    </div>
  );
}

/** RUN-2: the flows to run, chosen with checkboxes and kept for next time. */
function Flows({
  id,
  flows,
  initial,
}: {
  id: string;
  flows: FlowView[];
  initial: string[];
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(initial);
  useEffect(() => setChosen(initial), [initial]);

  const toggle = (file: string, on: boolean) => {
    const next = on ? [...chosen, file] : chosen.filter((f) => f !== file);
    setChosen(next);
    void window.jagra.projects.chooseFlows(id, next);
  };
  const broken = flows.filter((f) => f.problem).length;

  return (
    <Card className="gap-0 py-0">
      <div className="px-5 pt-4 pb-3">
        <h2 className="font-semibold">{t("project.flows.title")}</h2>
        {flows.length > 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="flows-chosen"
          >
            {t("project.flows.chosen", {
              chosen: chosen.length,
              total: flows.length,
            })}
            {broken > 0 && t("project.flows.cannotRun", { count: broken })}
          </p>
        )}
      </div>
      {flows.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          {t("project.flows.noneBefore")}{" "}
          <code className="font-mono">.jagra/flows</code>
          {t("project.flows.noneAfter")}
        </p>
      ) : (
        <ul>
          {flows.map((flow) =>
            flow.problem ? (
              <li
                key={flow.file}
                data-testid={`flow-${flow.file}`}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t px-5 py-2.5"
              >
                <Checkbox disabled className="mt-0.5" aria-label={flow.file} />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-medium">
                    {flow.file}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {describeError(flow.problem, t)}{" "}
                    {t("project.flows.leftOut")}
                  </span>
                </span>
                <Status tone="failed">{t("project.flows.broken")}</Status>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void window.jagra.projects.openFlow(id, flow.file)
                  }
                >
                  {t("projects.openFile")}
                </Button>
              </li>
            ) : (
              <li
                key={flow.file}
                data-testid={`flow-${flow.file}`}
                className="border-t"
              >
                <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-muted">
                  <Checkbox
                    checked={chosen.includes(flow.file)}
                    onCheckedChange={(value) =>
                      toggle(flow.file, value === true)
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{flow.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {flow.file}
                    </span>
                  </span>
                </label>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}

/** FLOW-3: helper flows, called from other flows and never run on their own. */
function Helpers({ id, helpers }: { id: string; helpers: HelperView[] }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-0 py-0">
      <div className="px-5 pt-4 pb-3">
        <h2 className="font-semibold">{t("project.helpers.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("project.helpers.subtitleBefore")}{" "}
          <code className="font-mono">runFlow</code>
          {t("project.helpers.subtitleAfter")}
        </p>
      </div>
      <ul>
        {helpers.map((helper) => (
          <li
            key={helper.file}
            data-testid={`helper-${helper.file}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-5 py-2.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm font-medium">
                {helper.file}
              </span>
              <span className="block text-sm text-muted-foreground">
                {helper.problem
                  ? describeError(helper.problem, t)
                  : t("project.helpers.usedBy", { count: helper.usedBy })}
              </span>
            </span>
            {helper.problem && (
              <Status tone="failed">{t("project.flows.broken")}</Status>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void window.jagra.projects.openFlow(id, helper.file)
              }
            >
              {t("project.helpers.open")}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** PRJ-4, PRJ-5: the APK, read again every few seconds so a new build shows at once. */
function ApkField({
  id,
  initial,
  searchPath,
}: {
  id: string;
  initial: Result<ApkView>;
  searchPath: string;
}) {
  const { t, i18n } = useTranslation();
  const [apk, setApk] = useState(initial);
  useEffect(() => setApk(initial), [initial]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void window.jagra.projects.apk(id).then((next) => {
        if (next) setApk(next);
      });
    }, APK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [id]);

  const change = async (to: "file" | "newest") => {
    const next = await window.jagra.projects.changeApk(id, to);
    if (next) setApk(next);
  };

  return (
    <div className="grid gap-1.5" data-testid="apk">
      <span className="text-sm font-medium">{t("project.run.apk")}</span>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {apk.ok ? (
            <>
              <span className="block truncate font-mono text-sm">
                {apk.value.fileName}
              </span>
              <span className="block text-sm text-muted-foreground">
                {apk.value.info.ok
                  ? t("project.run.apkVersion", {
                      version: apk.value.info.value.versionName,
                      code: apk.value.info.value.versionCode,
                      ago: formatAgo(
                        apk.value.modifiedAt,
                        Date.now(),
                        i18n.language,
                      ),
                    })
                  : describeError(apk.value.info.error, t)}
              </span>
              {apk.value.handPicked && (
                <span className="block text-sm text-muted-foreground">
                  {t("project.run.apkPicked")}
                </span>
              )}
            </>
          ) : (
            <Note tone="warning">
              <p>{describeError(apk.error, t)}</p>
            </Note>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {t("project.run.apkChange")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void change("newest")}>
              {t("project.run.apkNewest", { searchPath })}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void change("file")}>
              {t("project.run.apkFile")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** DEV-1 to DEV-3, DEV-6: the device for the run, with what to do when it is not ready. */
function DeviceField({
  id,
  saved,
  go,
}: {
  id: string;
  saved?: string;
  go: Go;
}) {
  const { t } = useTranslation();
  const { view, refresh } = useDevices();
  const [chosenId, setChosenId] = useState(saved);
  const devices = view?.devices ?? [];
  // DEV-3: the device used last, when it is there; otherwise the first one.
  const device = devices.find((d) => d.id === chosenId) ?? devices[0];

  const choose = (deviceId: string) => {
    setChosenId(deviceId);
    void window.jagra.projects.chooseDevice(id, deviceId);
  };

  return (
    <div className="grid gap-1.5" data-testid="device">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="device">{t("project.run.device")}</Label>
        {view?.adb && (
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            {t("project.run.refresh")}
          </Button>
        )}
      </div>
      {view && !view.adb ? (
        <Note tone="warning">
          <p>{t("project.device.noAdb")}</p>
          <div>
            <TextLink onClick={() => go({ screen: "environment" })}>
              {t("project.device.openCheck")}
            </TextLink>
          </div>
        </Note>
      ) : devices.length === 0 ? (
        view && (
          <Note tone="warning">
            <p>{t("project.device.none")}</p>
            <p className="text-muted-foreground">
              {t("project.device.noneHelp")}
            </p>
          </Note>
        )
      ) : (
        <>
          <Select value={device?.id} onValueChange={choose}>
            <SelectTrigger id="device" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {deviceLabel(d, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {device && <DeviceHelp device={device} />}
        </>
      )}
    </div>
  );
}

function deviceLabel(
  device: Device,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return t("project.device.option", {
    name: device.name,
    kind: t(`project.device.kind.${device.kind}`),
    state: t(`project.device.state.${device.state}`),
  });
}

function DeviceHelp({ device }: { device: Device }) {
  const { t } = useTranslation();
  if (device.kind === "emulator") {
    return (
      <span className="text-sm text-muted-foreground">
        {t(
          device.state === "emulator-starting"
            ? "project.device.starting"
            : "project.device.offStarts",
        )}
      </span>
    );
  }
  const checklist = (
    <ol className="grid list-decimal gap-1 pl-5 text-sm">
      {PHONE_CHECKLIST.map((item) => (
        <li key={item}>{t(`project.device.checklist.${item}`)}</li>
      ))}
    </ol>
  );
  if (device.state === "phone-not-authorised") {
    return (
      <Note tone="warning" testId="device-note">
        <p>{t("project.device.notAuthorised")}</p>
        {checklist}
      </Note>
    );
  }
  if (device.state === "phone-not-responding") {
    return (
      <Note tone="warning" testId="device-note">
        <p>{t("project.device.notResponding")}</p>
      </Note>
    );
  }
  return (
    <div className="grid gap-1 text-muted-foreground" data-testid="device-note">
      <span className="text-sm">{t("project.device.phoneReady")}</span>
      {checklist}
    </div>
  );
}

function MockoonLine({ mockoon }: { mockoon: ProjectDetails["mockoon"] }) {
  const { t } = useTranslation();
  if (!mockoon)
    return (
      <span className="text-sm text-muted-foreground">
        {t("project.run.noMockoon")}
      </span>
    );
  if (!mockoon.ok) {
    return (
      <Note tone="failed">
        <p>{describeError(mockoon.error, t)}</p>
      </Note>
    );
  }
  return (
    <span className="text-sm" data-testid="mockoon">
      <code className="font-mono">{mockoon.value.file}</code>
      {t("project.run.mockoonPort", { port: mockoon.value.port })}
    </span>
  );
}

function LastRunLine({ details }: { details: ProjectDetails }) {
  const { t, i18n } = useTranslation();
  const run = details.lastRun;
  if (!run)
    return (
      <span className="text-muted-foreground">{t("projects.noRunYet")}</span>
    );
  const look = runLook(run);
  return (
    <span className="grid gap-0.5">
      <span className="text-muted-foreground">
        {t("project.lastRun", {
          when: formatWhen(
            Date.parse(run.startedAt),
            Date.now(),
            i18n.language,
          ),
        })}
      </span>
      <Status tone={look.tone}>{t(look.label, look.values)}</Status>
    </span>
  );
}
