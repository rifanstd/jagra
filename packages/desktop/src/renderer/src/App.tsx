import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppInfo, Language } from "../../shared/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Label } from "./components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";

const LANGUAGES: readonly Language[] = ["en", "id"];

/** The placeholder screen of M7. The real screens replace it in M8. */
export function App({ initialLanguage }: { initialLanguage: Language }) {
  const { t, i18n } = useTranslation();
  const [info, setInfo] = useState<AppInfo>();
  const [language, setLanguage] = useState<Language>(initialLanguage);

  useEffect(() => {
    void window.jagra.app.info().then(setInfo);
  }, []);

  // LNG-1: the change shows at once, without a restart, and is kept for next time.
  const choose = async (value: string) => {
    if (value !== "en" && value !== "id") return;
    setLanguage(value);
    await i18n.changeLanguage(value);
    await window.jagra.settings.set({ language: value });
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{t("app.name")}</CardTitle>
          <CardDescription>{t("app.tagline")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground" data-testid="version">
            {info ? t("home.version", { version: info.version }) : " "}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="language">{t("home.language")}</Label>
            <Select
              value={language}
              onValueChange={(value) => void choose(value)}
            >
              <SelectTrigger id="language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`language.${code}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
