import type { ToolName } from "@jagra/core/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Language,
  Platform,
  ProjectSummary,
  SecretName,
  SettingsView,
} from "../../../shared/api";
import { Note } from "../components/note";
import { Status } from "../components/status";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { cn } from "../lib/utils";
import { TOOL_ORDER } from "../environment";
import type { EnvironmentCheck } from "../use-environment";

/** SET-1. The AI agent page arrives with the agents in M10 (D-78). */
const PAGES = ["secrets", "language", "tools", "editor"] as const;
type Page = (typeof PAGES)[number];

export type LanguageChoice = Language | "system";

/** Screen 11: Settings, one page at a time. Every setting is local data (SET-1). */
export function SettingsScreen({
  onLanguage,
  environment,
  platform,
}: {
  onLanguage: (choice: LanguageChoice) => Promise<void>;
  environment: EnvironmentCheck;
  platform: Platform;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>("secrets");
  const [view, setView] = useState<SettingsView>();

  useEffect(() => {
    void window.jagra.settings.get().then(setView);
  }, []);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold">{t("settings.title")}</h1>
      <div className="grid items-start gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          className="flex flex-wrap gap-1 md:flex-col"
          aria-label={t("settings.title")}
        >
          {PAGES.map((name) => (
            <button
              key={name}
              type="button"
              aria-current={page === name ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                page === name &&
                  "bg-secondary text-secondary-foreground hover:bg-secondary",
              )}
              onClick={() => setPage(name)}
            >
              {t(`settings.pages.${name}`)}
            </button>
          ))}
        </nav>
        {page === "secrets" && <SecretsPage />}
        {page === "language" && view && (
          <LanguagePage
            view={view}
            onChoose={async (choice) => {
              await onLanguage(choice);
              setView(await window.jagra.settings.get());
            }}
          />
        )}
        {page === "tools" && view && (
          <ToolsPage view={view} environment={environment} onChange={setView} />
        )}
        {page === "editor" && view && (
          <EditorPage view={view} platform={platform} onChange={setView} />
        )}
      </div>
    </main>
  );
}

function PageCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-4 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </Card>
  );
}

/** FLOW-7: the variables of a project's flows, and whether each has a value. Values never show. */
function SecretsPage() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [projectId, setProjectId] = useState<string>();
  const [names, setNames] = useState<SecretName[]>();
  const [editing, setEditing] = useState<string>();
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void window.jagra.projects.list().then((list) => {
      const ready = list.filter((p) => p.state === "ready");
      setProjects(ready);
      setProjectId(ready[0]?.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (projectId) setNames(await window.jagra.secrets.list(projectId));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!projectId || !editing) return;
    setFailed(false);
    try {
      await window.jagra.secrets.set(projectId, editing, value);
    } catch {
      setFailed(true);
      return;
    }
    setEditing(undefined);
    setValue("");
    await load();
  };

  return (
    <PageCard
      title={t("settings.pages.secrets")}
      description={t("settings.secrets.description")}
    >
      {projects && projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.secrets.noProjects")}
        </p>
      ) : (
        <>
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="secrets-project">
              {t("settings.secrets.project")}
            </Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="secrets-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.state === "ready" ? p.name : p.folder}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {names && names.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("settings.secrets.none")}
            </p>
          )}
          {names && names.length > 0 && (
            <ul className="rounded-md border" data-testid="secret-names">
              {names.map((secret) => (
                <li
                  key={secret.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 first:border-t-0"
                  data-testid={`secret-${secret.name}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-medium">
                      {secret.name}
                    </span>
                    {!secret.used && (
                      <span className="block text-sm text-muted-foreground">
                        {t("settings.secrets.unused")}
                      </span>
                    )}
                  </span>
                  {secret.hasValue ? (
                    <span
                      className="font-mono text-sm text-muted-foreground"
                      aria-label={t("settings.secrets.hidden")}
                    >
                      ***
                    </span>
                  ) : (
                    <Status tone="warning">
                      {t("settings.secrets.notSet")}
                    </Status>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(secret.name)}
                  >
                    {secret.hasValue
                      ? t("settings.secrets.change")
                      : t("settings.secrets.set")}
                  </Button>
                  {secret.hasValue && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void (
                          projectId &&
                          window.jagra.secrets
                            .remove(projectId, secret.name)
                            .then(load)
                        )
                      }
                    >
                      {t("settings.secrets.remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">
            {t("settings.secrets.note")}
          </p>
        </>
      )}

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <DialogHeader>
              <DialogTitle className="font-mono">{editing}</DialogTitle>
              <DialogDescription>{t("dialogs.secrets.hint")}</DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              autoComplete="off"
              aria-label={t("dialogs.secrets.placeholder", { name: editing })}
              placeholder={t("dialogs.secrets.placeholder", { name: editing })}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {failed && (
              <Note tone="failed">
                <p>{t("dialogs.secrets.failed")}</p>
              </Note>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(undefined)}
              >
                {t("dialogs.secrets.cancel")}
              </Button>
              <Button type="submit" disabled={value === ""}>
                {t("settings.secrets.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageCard>
  );
}

/** LNG-1: changes at once, without a restart. "Follow the system" clears the choice. */
function LanguagePage({
  view,
  onChoose,
}: {
  view: SettingsView;
  onChoose: (choice: LanguageChoice) => Promise<void>;
}) {
  const { t } = useTranslation();
  const choice: LanguageChoice = view.settings.language ?? "system";
  return (
    <PageCard
      title={t("settings.language.title")}
      description={t("settings.language.description")}
    >
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="language">{t("settings.language.label")}</Label>
        <Select
          value={choice}
          onValueChange={(value) => {
            if (value === "en" || value === "id" || value === "system")
              void onChoose(value);
          }}
        >
          <SelectTrigger id="language" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">
              {t("settings.language.system", {
                current: t(`language.${view.language}`),
              })}
            </SelectItem>
            <SelectItem value="en">{t("language.en")}</SelectItem>
            <SelectItem value="id">{t("language.id")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("settings.language.note")}
      </p>
    </PageCard>
  );
}

/** ENV-6: a path set by hand wins over detection. Paths come only from the system's dialog. */
function ToolsPage({
  view,
  environment,
  onChange,
}: {
  view: SettingsView;
  environment: EnvironmentCheck;
  onChange: (view: SettingsView) => void;
}) {
  const { t } = useTranslation();
  const set = view.settings.toolPaths ?? {};

  const change = async (next: SettingsView | undefined) => {
    if (!next) return;
    onChange(next);
    await environment.check();
  };

  return (
    <PageCard
      title={t("settings.pages.tools")}
      description={t("settings.tools.description")}
    >
      <ul className="rounded-md border" data-testid="tool-locations">
        {TOOL_ORDER.map((tool: ToolName) => {
          const byHand = set[tool];
          const found = environment.view?.tools.find(
            (v) => v.status.tool === tool,
          )?.status.path;
          return (
            <li
              key={tool}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 first:border-t-0"
              data-testid={`location-${tool}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {t(`env.tool.${tool}.name`)}
                </span>
                <span
                  className="block truncate font-mono text-xs text-muted-foreground"
                  title={byHand ?? found}
                >
                  {byHand
                    ? t("settings.tools.byHand", { path: byHand })
                    : found
                      ? t("settings.tools.automatic", { path: found })
                      : t("settings.tools.notFound")}
                </span>
              </span>
              {byHand ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void window.jagra.settings.resetToolPath(tool).then(change)
                  }
                >
                  {t("settings.tools.reset")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void window.jagra.settings.pickToolPath(tool).then(change)
                  }
                >
                  {t("settings.tools.set")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          variant="outline"
          disabled={environment.checking}
          onClick={() => void environment.check()}
        >
          {t("settings.tools.checkAgain")}
        </Button>
      </div>
    </PageCard>
  );
}

/** FLOW-5: the system's default app, or a program chosen through the system's dialog (D-96). */
function EditorPage({
  view,
  platform,
  onChange,
}: {
  view: SettingsView;
  platform: Platform;
  onChange: (view: SettingsView) => void;
}) {
  const { t } = useTranslation();
  const editor = view.settings.editor;

  const pick = async () => {
    const next = await window.jagra.settings.pickEditor();
    if (next) onChange(next);
  };

  return (
    <PageCard
      title={t("settings.pages.editor")}
      description={t("settings.editor.description")}
    >
      <RadioGroup
        value={editor ? "program" : "system"}
        onValueChange={(value) => {
          if (value === "system")
            void window.jagra.settings.resetEditor().then(onChange);
          else if (!editor) void pick();
        }}
      >
        <div className="flex items-center gap-2.5">
          <RadioGroupItem value="system" id="editor-system" />
          <Label htmlFor="editor-system" className="font-normal">
            {t("settings.editor.system")}
          </Label>
        </div>
        <div className="flex items-center gap-2.5">
          <RadioGroupItem value="program" id="editor-program" />
          <Label htmlFor="editor-program" className="font-normal">
            {t("settings.editor.program")}
          </Label>
        </div>
      </RadioGroup>
      {editor && (
        <div className="ml-6.5 flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 truncate font-mono text-sm"
            data-testid="editor-path"
            title={editor}
          >
            {editor}
          </code>
          <Button variant="outline" size="sm" onClick={() => void pick()}>
            {t("settings.editor.choose")}
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {t(
          platform === "darwin"
            ? "settings.editor.hintMac"
            : "settings.editor.hintWindows",
        )}
      </p>
    </PageCard>
  );
}
