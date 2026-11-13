import type { JagraError } from "@jagra/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApkView, FolderPreview } from "../../../shared/api";
import { Note } from "../components/note";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { describeError } from "../errors";
import { formatAgo } from "../format";
import type { Go } from "../navigation";

const STARTER_FILES = [
  ".jagra/config.yaml",
  ".jagra/agent-rules.md",
  ".jagra/flows/",
  ".jagra/flows/parts/",
];

/** Screen 3: picks the app's folder, its name, its APK and an optional Mockoon file (PRJ-1 to PRJ-6). */
export function CreateProjectScreen({ go }: { go: Go }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<FolderPreview>();
  const [name, setName] = useState("");
  const [apkChoice, setApkChoice] = useState<"search" | "picked">("search");
  const [picked, setPicked] = useState<ApkView>();
  const [mockoon, setMockoon] = useState<string>();
  const [mockoonError, setMockoonError] = useState<JagraError>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<JagraError>();

  const pickFolder = async () => {
    const chosen = await window.jagra.projects.pickFolder();
    if (!chosen) return;
    setPreview(chosen);
    setName(chosen.name);
    setApkChoice("search");
    setPicked(undefined);
    setMockoon(chosen.mockoonFile);
    setMockoonError(undefined);
    setError(undefined);
  };

  const pickApk = async () => {
    const apk = await window.jagra.projects.pickApk();
    if (apk) {
      setPicked(apk);
      setApkChoice("picked");
    }
  };

  const pickMockoon = async () => {
    const file = await window.jagra.projects.pickMockoon();
    if (!file) return;
    if (file.ok) {
      setMockoon(file.value);
      setMockoonError(undefined);
    } else {
      setMockoonError(file.error);
    }
  };

  const create = async () => {
    setCreating(true);
    setError(undefined);
    const result = await window.jagra.projects.create({
      name: name.trim(),
      apk: apkChoice,
    });
    setCreating(false);
    if (result.ok) go({ screen: "project", id: result.value.id });
    else setError(result.error);
  };

  const usable = preview && !preview.configError;
  const ready =
    preview !== undefined &&
    (preview.configError !== undefined || name.trim() !== "") &&
    (apkChoice === "search" || picked !== undefined);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("create.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("create.subtitle")}</p>
      </div>

      <Card className="gap-0 py-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !creating) void create();
          }}
        >
          <div className="grid gap-5 px-5 pt-5 pb-5">
            <div className="grid gap-1.5">
              <Label htmlFor="folder">{t("create.folder")}</Label>
              <div className="flex gap-2">
                <Input
                  id="folder"
                  readOnly
                  className="font-mono"
                  value={preview?.folder ?? ""}
                  placeholder={t("create.noFolder")}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void pickFolder()}
                >
                  {t("create.chooseFolder")}
                </Button>
              </div>
              {preview && <FolderNote preview={preview} />}
            </div>

            {usable && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="name">{t("create.name")}</Label>
                  <Input
                    id="name"
                    value={name}
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("create.nameHintBefore")}{" "}
                    <code className="font-mono">.jagra/config.yaml</code>
                    {t("create.nameHintAfter")}
                  </span>
                </div>

                <fieldset className="grid gap-2">
                  <legend className="mb-1.5 text-sm font-medium">
                    {t("create.apk")}
                  </legend>
                  <RadioGroup
                    value={apkChoice}
                    onValueChange={(value) => {
                      if (value === "search") setApkChoice("search");
                      else if (picked) setApkChoice("picked");
                      else void pickApk();
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <RadioGroupItem value="search" id="apk-search" />
                      <Label htmlFor="apk-search" className="font-normal">
                        {t("create.apkNewest")}{" "}
                        <code className="font-mono">{preview.searchPath}</code>
                      </Label>
                    </div>
                    <div className="ml-6.5">
                      <SearchedApk preview={preview} />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <RadioGroupItem value="picked" id="apk-picked" />
                      <Label htmlFor="apk-picked" className="font-normal">
                        {t("create.apkChoose")}
                      </Label>
                    </div>
                    {picked && (
                      <div className="ml-6.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <ApkLine apk={picked} />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void pickApk()}
                        >
                          {t("create.apkChooseOther")}
                        </Button>
                      </div>
                    )}
                  </RadioGroup>
                </fieldset>

                <div className="grid gap-1.5">
                  <Label htmlFor="mockoon">
                    {t("create.mockoon")}{" "}
                    <span className="font-normal text-muted-foreground">
                      {t("create.optional")}
                    </span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="mockoon"
                      readOnly
                      className="font-mono"
                      value={mockoon ?? ""}
                      placeholder={t("create.noMockoon")}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void pickMockoon()}
                    >
                      {t("create.chooseFile")}
                    </Button>
                  </div>
                  {mockoonError && (
                    <Note tone="failed">
                      <p>{describeError(mockoonError, t)}</p>
                    </Note>
                  )}
                  {mockoon && (
                    <Note tone="info" testId="mockoon-tips">
                      <p>{t("create.mockoonTips")}</p>
                      <ul className="grid list-disc gap-1 pl-5">
                        <li>{t("create.mockoonTipUrl")}</li>
                        <li>{t("create.mockoonTipHttp")}</li>
                      </ul>
                    </Note>
                  )}
                </div>
              </>
            )}

            {error && (
              <Note tone="failed">
                <p>{describeError(error, t)}</p>
              </Note>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => go({ screen: "projects" })}
            >
              {t("create.cancel")}
            </Button>
            <Button type="submit" disabled={!ready || creating}>
              {preview?.configError ? t("create.addAsIs") : t("create.submit")}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

/** What picking this folder will do to it (PRJ-1, PRJ-9, PRJ-10). */
function FolderNote({ preview }: { preview: FolderPreview }) {
  const { t } = useTranslation();
  if (preview.configError) {
    return (
      <Note tone="warning" testId="folder-note">
        <p>{describeError(preview.configError, t)}</p>
        <p className="text-muted-foreground">{t("create.brokenConfig")}</p>
      </Note>
    );
  }
  if (!preview.hasConfig) {
    return (
      <Note tone="info" testId="folder-note">
        <p>{t("create.newJagra")}</p>
        <p className="font-mono text-xs leading-relaxed">
          {STARTER_FILES.map((file) => (
            <span key={file} className="block">
              {file}
            </span>
          ))}
        </p>
        <p className="text-muted-foreground">{t("create.nothingElse")}</p>
      </Note>
    );
  }
  return (
    <Note tone="info" testId="folder-note">
      <p>
        {t(
          preview.mockoonFile
            ? "create.existingWithMockoon"
            : "create.existing",
          {
            flows: preview.flows,
            helpers: preview.helpers,
          },
        )}
      </p>
      <p className="text-muted-foreground">{t("create.teamHint")}</p>
    </Note>
  );
}

function SearchedApk({ preview }: { preview: FolderPreview }) {
  const { t } = useTranslation();
  if (preview.apk.ok) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="found-apk">
        {t("create.found")} <ApkLine apk={preview.apk.value} />{" "}
        {t("create.newBuildsUsed")}
      </p>
    );
  }
  return (
    <Note tone="warning" testId="found-apk">
      <p>{t("create.noApk")}</p>
    </Note>
  );
}

/** File name, version and age of an APK (PRJ-5). */
function ApkLine({ apk }: { apk: ApkView }) {
  const { t, i18n } = useTranslation();
  const ago = formatAgo(apk.modifiedAt, Date.now(), i18n.language);
  return (
    <span>
      <code className="font-mono">{apk.fileName}</code>
      {", "}
      {apk.info.ok
        ? t("create.apkVersion", {
            version: apk.info.value.versionName,
            code: apk.info.value.versionCode,
            ago,
          })
        : t("create.apkBuilt", { ago })}
    </span>
  );
}
