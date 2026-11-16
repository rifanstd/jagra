import type { JagraError } from "@jagra/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "../errors";
import { Note } from "./note";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** FLOW-4: asks for a name, creates the flow from the template and opens it in the editor. */
export function NewFlowDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: (created: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState<JagraError>();
  const [busy, setBusy] = useState(false);

  const close = (created: boolean) => {
    setName("");
    setError(undefined);
    onClose(created);
  };

  const create = async () => {
    setBusy(true);
    const result = await window.jagra.projects.newFlow(projectId, name.trim());
    setBusy(false);
    if (result.ok) close(true);
    else setError(result.error);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close(false)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !busy) void create();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("newFlow.title")}</DialogTitle>
            <DialogDescription>{t("newFlow.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="new-flow-name">{t("newFlow.name")}</Label>
            <Input
              id="new-flow-name"
              value={name}
              maxLength={100}
              placeholder={t("newFlow.placeholder")}
              onChange={(event) => {
                setName(event.target.value);
                setError(undefined);
              }}
            />
          </div>
          {error && (
            <Note tone="failed">
              <p>{describeError(error, t)}</p>
            </Note>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => close(false)}
            >
              {t("newFlow.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {t("newFlow.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
