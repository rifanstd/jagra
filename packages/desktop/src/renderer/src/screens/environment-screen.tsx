import type { ToolName, ToolStatus } from "@jagra/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Platform, ToolView } from "../../../shared/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Status } from "../components/status";
import { TextLink } from "../components/text-link";
import {
  blockingTool,
  guideShown,
  REQUIRED_TOOLS,
  TOOL_ORDER,
  toolLook,
} from "../environment";
import type { EnvironmentCheck } from "../use-environment";

/** Screen 1: every tool with its state and, when it is not ready, how to fix it (ENV). */
export function EnvironmentScreen({
  environment,
  platform,
  onContinue,
}: {
  environment: EnvironmentCheck;
  platform: Platform;
  onContinue: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { view, progress, checking, failed, check } = environment;
  const required = TOOL_ORDER.filter((tool) => REQUIRED_TOOLS.has(tool));
  const optional = TOOL_ORDER.filter((tool) => !REQUIRED_TOOLS.has(tool));
  const tool = (name: ToolName): ToolView | undefined => {
    if (checking) {
      const status = progress[name];
      return status && { status };
    }
    return view?.tools.find((t) => t.status.tool === name);
  };
  const seconds = view
    ? new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(view.tookMs / 1000)
    : "";
  const untested =
    !checking && view?.tools.some((t) => t.status.state === "untested-version");
  const ready = !checking && !failed && view?.ready === true;
  const blocking = !checking && view ? blockingTool(view) : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold">{t("env.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("env.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          disabled={checking}
          onClick={() => void check()}
        >
          {t("env.checkAgain")}
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
          <h2 className="font-semibold">{t("env.required")}</h2>
          <span
            className="text-sm text-muted-foreground"
            data-testid="check-summary"
          >
            {checking
              ? t("env.checking")
              : view
                ? t("env.took", { seconds })
                : ""}
          </span>
        </div>
        <ul>
          {required.map((name) => (
            <ToolRow
              key={name}
              name={name}
              tool={tool(name)}
              platform={platform}
            />
          ))}
        </ul>
      </Card>

      <Card className="mt-5 gap-0 py-0">
        <div className="px-5 pt-4 pb-3">
          <h2 className="font-semibold">{t("env.optional")}</h2>
        </div>
        <ul>
          {optional.map((name) => (
            <ToolRow
              key={name}
              name={name}
              tool={tool(name)}
              platform={platform}
            />
          ))}
        </ul>
      </Card>

      {failed && (
        <p role="alert" className="mt-3 text-sm">
          {t("env.failed")}
        </p>
      )}
      {untested && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("env.untestedNote")}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {blocking && (
          <span className="text-sm text-muted-foreground">
            {t("env.continueAfter", {
              tool: t(`env.tool.${blocking.tool}.name`),
            })}
          </span>
        )}
        <Button size="lg" disabled={!ready} onClick={onContinue}>
          {t("env.continue")}
        </Button>
      </div>
    </main>
  );
}

function ToolRow({
  name,
  tool,
  platform,
}: {
  name: ToolName;
  tool: ToolView | undefined;
  platform: Platform;
}) {
  const { t } = useTranslation();
  const status = tool?.status;
  const look = toolLook(status);
  const shown = status ? guideShown(status) : "none";
  const [opened, setOpened] = useState(false);
  const guideId = `guide-${name}`;
  const required = REQUIRED_TOOLS.has(name);

  return (
    <li
      className="border-t px-5 py-2.5 first:border-t-0"
      data-testid={`tool-${name}`}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t(`env.tool.${name}.title`)}</div>
          {required ? (
            status?.path && (
              <div
                className="truncate font-mono text-xs text-muted-foreground"
                title={status.path}
              >
                {status.path}
              </div>
            )
          ) : (
            <div className="text-sm text-muted-foreground">
              {t(`env.tool.${name}.note`)}
            </div>
          )}
        </div>
        {status?.version && (
          <span className="text-sm text-muted-foreground">
            {status.version}
          </span>
        )}
        <Status tone={look.tone}>{t(look.label)}</Status>
        {shown === "closed" && tool?.guide && (
          <TextLink
            aria-expanded={opened}
            aria-controls={guideId}
            onClick={() => setOpened(!opened)}
          >
            {t("env.howToInstall")}
          </TextLink>
        )}
      </div>
      {tool?.guide && status && (shown === "open" || opened) && (
        <Guide
          id={guideId}
          status={status}
          guide={tool.guide}
          platform={platform}
        />
      )}
    </li>
  );
}

/** Install or update instructions for this system, with the official page (ENV-4). */
function Guide({
  id,
  status,
  guide,
  platform,
}: {
  id: string;
  status: ToolStatus;
  guide: NonNullable<ToolView["guide"]>;
  platform: Platform;
}) {
  const { t } = useTranslation();
  const reason =
    status.state === "cant-start"
      ? t(`env.problem.${status.problem ?? "failed"}`)
      : status.state === "too-old"
        ? t("env.problem.too-old", { version: status.version ?? "" })
        : status.state === "untested-version"
          ? t("env.problem.untested-version")
          : t(`env.tool.${status.tool}.why`);
  return (
    <div
      id={id}
      className="mt-3 grid gap-2.5 pb-2 text-sm"
      data-testid={`guide-${status.tool}`}
    >
      <p>
        {reason} {t("env.stepsFor", { system: t(`system.${platform}`) })}
      </p>
      <ol className="grid list-decimal gap-2 pl-5">
        {guide.steps.map(({ id: step, url, copy }) => (
          <li key={step}>
            <span>{t(`install.${step}`)}</span>
            {url && (
              <>
                {" "}
                <TextLink onClick={() => void window.jagra.app.openLink(url)}>
                  {t("env.openPage")}
                </TextLink>
              </>
            )}
            {copy && <CopyLine value={copy} />}
          </li>
        ))}
      </ol>
      <p>
        <TextLink onClick={() => void window.jagra.app.openLink(guide.url)}>
          {t("env.officialGuide", { tool: t(`env.tool.${status.tool}.name`) })}
        </TextLink>
      </p>
    </div>
  );
}

/** A command or path shown as-is, with a button that copies it. */
function CopyLine({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await window.jagra.app.copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-md border bg-muted py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">
        {value}
      </code>
      <Button variant="ghost" size="sm" onClick={() => void copy()}>
        <span aria-live="polite">
          {copied ? t("env.copied") : t("env.copy")}
        </span>
      </Button>
    </div>
  );
}
