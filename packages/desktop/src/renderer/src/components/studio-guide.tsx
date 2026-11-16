import { useTranslation } from "react-i18next";
import { MAESTRO_STUDIO_DOCS } from "../../../shared/api";
import { TextLink } from "./text-link";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const STEPS = ["install", "device", "open", "rightClick", "copy"] as const;

/**
 * FLOW-9: a short guide to finding element names with Maestro Studio, Maestro's own desktop app
 * (D-100). Jagra never installs it (ENV-9); the guide links to Maestro's page.
 */
export function StudioGuide({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("studio.title")}</DialogTitle>
          <DialogDescription>{t("studio.intro")}</DialogDescription>
        </DialogHeader>
        <ol
          className="grid list-decimal gap-2 pl-5 text-sm"
          data-testid="studio-steps"
        >
          {STEPS.map((step) => (
            <li key={step}>{t(`studio.steps.${step}`)}</li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">{t("studio.tip")}</p>
        <p className="text-sm">
          <TextLink
            onClick={() => void window.jagra.app.openLink(MAESTRO_STUDIO_DOCS)}
          >
            {t("studio.docs")}
          </TextLink>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("studio.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
