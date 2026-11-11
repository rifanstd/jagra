import { useTranslation } from "react-i18next";

/** Screen 2. The list, the empty list and the sample app arrive in the next pull request of M8. */
export function ProjectsScreen() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-6">
      <h1 className="text-2xl font-semibold">{t("projects.title")}</h1>
    </main>
  );
}
