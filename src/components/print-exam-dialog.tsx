import { Printer } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { printoutUrl } from "@/lib/exam-printout";

/**
 * Antes de imprimir se pregunta si van los avisos. No se decide solo porque
 * depende de para qué es la copia: la que se le muestra a una familia no es la
 * que se archiva para un reclamo.
 */
export function PrintExamDialog({
  open,
  onOpenChange,
  runId,
  participantId,
  subject,
  incidentCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  /** Sin alumno se imprime la toma entera, uno por hoja. */
  participantId?: string;
  /** A quién se imprime, para el texto del diálogo: un nombre o "los 24 alumnos". */
  subject: string;
  incidentCount?: number;
}) {
  const [choice, setChoice] = useState<"sin" | "con">("sin");

  function openPrintout() {
    window.open(
      printoutUrl({ runId, participantId, includeIncidents: choice === "con", autoPrint: true }),
      "_blank",
      "noopener",
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Imprimir examen</DialogTitle>
          <DialogDescription>
            Se abre una hoja con las preguntas, las respuestas y la nota final de {subject}. Desde ahí podés imprimirla o guardarla en PDF.
          </DialogDescription>
        </DialogHeader>
        <FieldSet>
          <RadioGroup value={choice} onValueChange={(value) => setChoice(value as "sin" | "con")} className="grid gap-2">
            <FieldLabel className="bg-paper">
              <Field orientation="horizontal">
                <RadioGroupItem value="sin" />
                <FieldContent>
                  <FieldTitle>Sin incidentes</FieldTitle>
                  <FieldDescription>Solo el examen corregido: preguntas, respuestas, devoluciones y nota.</FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
            <FieldLabel className="bg-paper">
              <Field orientation="horizontal">
                <RadioGroupItem value="con" />
                <FieldContent>
                  <FieldTitle>
                    Con incidentes
                    {incidentCount !== undefined ? <span className="mono-number font-normal text-muted">({incidentCount})</span> : null}
                  </FieldTitle>
                  <FieldDescription>Agrega al final el registro de supervisión, con la hora, la duración y la pregunta de cada aviso.</FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          </RadioGroup>
        </FieldSet>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={openPrintout}>
            <Printer />
            Abrir para imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
