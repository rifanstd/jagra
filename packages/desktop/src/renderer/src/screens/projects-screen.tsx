import type { JagraError } from "@jagra/core/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectSummary } from "../../../shared/api";
import { Note } from "../components/note";
import { Status } from "../components/status";
import { TextLink } from "../components/text-link";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { blockingTool } from "../environment";
import { describeError } from "../errors";
import { formatWhen } from "../format";
import type { Go } from "../navigation";
import { runLook } from "../run-look";
import type { EnvironmentCheck } from "../use-environment";

/** Screens 2 and 9: every project with its last result, or the way in for a new user (PRJ-7, SMP-6). */
export function ProjectsScreen({
  go,
  environment,
}: {
  go: Go;
  environment: EnvironmentCheck;
}) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>();

  const load = useCallback(async () => {
    setProjects(await window.jagra.projects.list());
  }, []);

  useEffect(() => {
    void load();
    // A folder moved or deleted outside Jagra shows up when the user comes back (PRJ-8).
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  if (!projects) return <main className="flex-1" />;
  if (projects.length === 0) return <EmptyProjects go={go} />;

  const blocking = environment.view && blockingTool(environment.view);
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold">{t("projects.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("projects.subtitleBefore")}{" "}
            <code className="font-mono text-sm">.jagra</code>{" "}
            {t("projects.subtitleAfter")}
          </p>
        </div>
        <Button onClick={() => go({ screen: "create" })}>
          {t("projects.create")}
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <ul aria-label={t("projects.listLabel")}>
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              go={go}
              reload={load}
            />
          ))}
        </ul>
      </Card>

      <p className="mt-3 text-sm text-muted-foreground">
        {t("projects.removeNote")}
      </p>
      {blocking && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
          <Status tone="failed">
            {t(`env.indicator.${blocking.state}`, {
              tool: t(`env.tool.${blocking.tool}.name`),
            })}
          </Status>
          <span>{t("projects.runsBlocked")}</span>
          <TextLink onClick={() => go({ screen: "environment" })}>
            {t("projects.seeHowToInstall")}
          </TextLink>
        </p>
      )}
    </main>
  );
}

const ROW =
  "flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-5 py-2.5 first:border-t-0";

function ProjectRow({
  project,
  go,
  reload,
}: {
  project: ProjectSummary;
  go: Go;
  reload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const folderLine = (
    <span
      className="block truncate font-mono text-xs text-muted-foreground"
      title={project.folder}
    >
      {project.folder}
    </span>
  );

  if (project.state === "ready") {
    const look = project.lastRun && runLook(project.lastRun);
    return (
      <li className="border-t first:border-t-0">
        <button
          type="button"
          data-testid={`project-${project.id}`}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          onClick={() => go({ screen: "project", id: project.id })}
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{project.name}</span>
            {folderLine}
          </span>
          {project.lastRun && look ? (
            <>
              <span className="text-sm text-muted-foreground">
                {formatWhen(
                  Date.parse(project.lastRun.startedAt),
                  Date.now(),
                  i18n.language,
                )}
              </span>
              <Status tone={look.tone}>{t(look.label, look.values)}</Status>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("projects.noRunYet")}
            </span>
          )}
        </button>
      </li>
    );
  }

  if (project.state === "missing") {
    return (
      <li className={ROW} data-testid={`project-${project.id}`}>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            {folderName(project.folder)}
          </span>
          {folderLine}
        </span>
        <Status tone="warning">{t("projects.folderMissing")}</Status>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void window.jagra.projects.locate(project.id).then(reload)
          }
        >
          {t("projects.locate")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void window.jagra.projects.remove(project.id).then(reload)
          }
        >
          {t("projects.remove")}
        </Button>
      </li>
    );
  }

  return (
    <li className={ROW} data-testid={`project-${project.id}`}>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{folderName(project.folder)}</span>
        <span className="block text-sm text-muted-foreground">
          {describeError(project.error, t)}
        </span>
      </span>
      <Status tone="failed">{t("projects.configProblem")}</Status>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void window.jagra.projects.openConfig(project.id)}
      >
        {t("projects.openFile")}
      </Button>
    </li>
  );
}

function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
}

/** Screen 9: no projects yet. The sample shows a failing flow on the first run (SMP-6). */
function EmptyProjects({ go }: { go: Go }) {
  const { t } = useTranslation();
  const [copying, setCopying] = useState<string>();
  const [error, setError] = useState<JagraError>();

  const trySample = async () => {
    setError(undefined);
    setCopying(await window.jagra.projects.sampleFolder());
    const result = await window.jagra.projects.trySample();
    if (result.ok) {
      go({ screen: "project", id: result.value.id });
    } else {
      setCopying(undefined);
      setError(result.error);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-16 pb-12 sm:px-6">
      <Card className="gap-4 p-8">
        <h1 className="text-2xl font-semibold">{t("projects.empty.title")}</h1>
        <p>{t("projects.empty.text")}</p>
        {copying ? (
          <Status tone="running" className="whitespace-normal">
            {t("projects.empty.copying", { folder: copying })}
          </Status>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="lg" onClick={() => void trySample()}>
              {t("projects.empty.trySample")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => go({ screen: "create" })}
            >
              {t("projects.empty.create")}
            </Button>
          </div>
        )}
        {error && (
          <Note tone="failed">
            <p>{describeError(error, t)}</p>
          </Note>
        )}
      </Card>
    </main>
  );
}
