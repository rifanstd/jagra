import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { REPOSITORY, type AppInfo } from "../../../shared/api";
import { TextLink } from "../components/text-link";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

/** Screen 12 (ABT-1). Check for updates arrives with the updates in M11 (D-78). */
export function AboutScreen() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AppInfo>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.jagra.app.info().then(setInfo);
  }, []);

  const copy = async () => {
    await window.jagra.app.copyBugInfo();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
      <Card className="gap-5 p-6">
        <div>
          <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
          <p className="text-muted-foreground">{t("app.tagline")}</p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{t("about.version")}</dt>
          <dd data-testid="version">{info?.version}</dd>
          <dt className="text-muted-foreground">{t("about.createdBy")}</dt>
          <dd>{t("about.creator")}</dd>
          <dt className="text-muted-foreground">{t("about.license")}</dt>
          <dd>{t("about.mit")}</dd>
          <dt className="text-muted-foreground">{t("about.source")}</dt>
          <dd>
            <TextLink
              onClick={() => void window.jagra.app.openLink(REPOSITORY)}
            >
              {REPOSITORY.replace("https://", "")}
            </TextLink>
          </dd>
        </dl>
        <div>
          <Button variant="outline" onClick={() => void copy()}>
            <span aria-live="polite">
              {copied ? t("about.copied") : t("about.copyBugInfo")}
            </span>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("about.bugInfoNote")}
        </p>
      </Card>
    </main>
  );
}
