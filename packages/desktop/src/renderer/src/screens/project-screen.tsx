import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectView } from "../../../shared/api";
import { Note } from "../components/note";
import { Button } from "../components/ui/button";
import { describeError } from "../errors";
import type { Go } from "../navigation";

/** Screen 4. This pull request has its heading and Remove from list; flows, APK and devices follow. */
export function ProjectScreen({ id, go }: { id: string; go: Go }) {
  const { t } = useTranslation();
  const [project, setProject] = useState<ProjectView | null>();

  const load = useCallback(async () => {
    setProject((await window.jagra.projects.get(id)) ?? null);
  }, [id]);

  useEffect(() => {
    void load();
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
    </main>
  );
}
