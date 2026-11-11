import { useTranslation } from "react-i18next";
import type { Language } from "../../../shared/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

const LANGUAGES: readonly Language[] = ["en", "id"];

/** Screen 11. This pull request has the Language page; the other pages follow in M8. */
export function SettingsScreen({
  language,
  onLanguage,
}: {
  language: Language;
  onLanguage: (language: Language) => void;
}) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold">{t("settings.title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language.title")}</CardTitle>
          <CardDescription>
            {t("settings.language.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-xs flex-col gap-2">
          <Label htmlFor="language">{t("settings.language.label")}</Label>
          <Select
            value={language}
            onValueChange={(value) => {
              if (value === "en" || value === "id") onLanguage(value);
            }}
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
        </CardContent>
      </Card>
    </main>
  );
}
