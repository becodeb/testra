import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardPaste,
  Copy,
  GripVertical,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";

import {
  examTotalPoints,
  getQuestionCompletion,
  type ExamDraft,
  type FullQuestion,
  type QuestionType,
} from "@/domain/exam";
import { StatusBadge } from "@/components/status-badge";
import { QuestionNavigator } from "@/components/question-navigator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const TYPE_LABELS: Record<QuestionType, string> = {
  mc: "Opción única",
  ms: "Varias opciones",
  tf: "Verdadero / Falso",
  sa: "Respuesta corta",
  long: "Desarrollo",
};

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeQuestion(type: QuestionType = "mc", position = 0): FullQuestion {
  const base = { id: id("q"), position, prompt: "", points: 1 };
  const options = [
    { id: id("op"), text: "" },
    { id: id("op"), text: "" },
  ];

  switch (type) {
    case "mc":
      return { ...base, type, config: { options, correctOptionId: "" } };
    case "ms":
      return { ...base, type, config: { options, correctOptionIds: [] } };
    case "tf":
      return { ...base, type, config: { correct: true } };
    case "sa":
      return { ...base, type, config: { accepted: [""] } };
    case "long":
      return { ...base, type, config: {} };
  }
}

export const sampleQuestions: FullQuestion[] = [
  {
    id: "q-demo-1",
    position: 0,
    type: "mc",
    prompt: "¿Qué proceso permite que las plantas transformen energía lumínica en energía química?",
    points: 2,
    config: {
      options: [
        { id: "q1-a", text: "Respiración celular" },
        { id: "q1-b", text: "Fotosíntesis" },
        { id: "q1-c", text: "Fermentación" },
        { id: "q1-d", text: "Transpiración" },
      ],
      correctOptionId: "q1-b",
    },
  },
  {
    id: "q-demo-2",
    position: 1,
    type: "ms",
    prompt: "Seleccioná los componentes que intervienen directamente en la fotosíntesis.",
    points: 3,
    config: {
      options: [
        { id: "q2-a", text: "Dióxido de carbono" },
        { id: "q2-b", text: "Agua" },
        { id: "q2-c", text: "Oxígeno como reactivo" },
        { id: "q2-d", text: "Luz" },
      ],
      correctOptionIds: ["q2-a", "q2-b", "q2-d"],
    },
  },
  {
    id: "q-demo-3",
    position: 2,
    type: "sa",
    prompt: "¿Cómo se llama el pigmento principal que absorbe la luz?",
    points: 2,
    config: { accepted: ["clorofila"] },
  },
  {
    id: "q-demo-4",
    position: 3,
    type: "long",
    prompt: "Explicá por qué la fotosíntesis es importante para los ecosistemas.",
    points: 3,
    config: {},
  },
];

function parsePastedExam(text: string): FullQuestion[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, position) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const prompt = (lines.shift() ?? "").replace(/^\d+[).\-]\s*/, "");
    const optionLines = lines.filter((line) => /^[A-Ha-h][).\-]\s+/.test(line));

    if (optionLines.length >= 2) {
      const question = makeQuestion("mc", position);
      if (question.type !== "mc") return question;
      return {
        ...question,
        prompt,
        config: {
          options: optionLines.map((line) => ({
            id: id("op"),
            text: line.replace(/^[A-Ha-h][).\-]\s+/, ""),
          })),
          correctOptionId: "",
        },
      };
    }

    return { ...makeQuestion("long", position), prompt } as FullQuestion;
  });
}

interface ExamEditorProps {
  initialExam: ExamDraft;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <FieldLabel className="bg-white"><Field orientation="horizontal"><Checkbox aria-label={label} checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} /><span>{label}</span></Field></FieldLabel>;
}

export function ExamEditor({ initialExam }: ExamEditorProps) {
  const [title, setTitle] = useState(initialExam.title);
  const [subject, setSubject] = useState(initialExam.subject);
  const [instructions, setInstructions] = useState(initialExam.instructions);
  const [timeLimit, setTimeLimit] = useState(initialExam.timeLimitS / 60);
  const [shuffleQuestions, setShuffleQuestions] = useState(initialExam.shuffleQuestions);
  const [shuffleOptions, setShuffleOptions] = useState(initialExam.shuffleOptions);
  const [allowBackwards, setAllowBackwards] = useState(initialExam.allowBackwards);
  const [showProgress, setShowProgress] = useState(initialExam.showProgress);
  const [autoSubmit, setAutoSubmit] = useState(initialExam.autoSubmit);
  const [allowReconnect, setAllowReconnect] = useState(initialExam.allowReconnect);
  const [supervisionLevel, setSupervisionLevel] = useState(initialExam.supervisionLevel);
  const [requireFullscreen, setRequireFullscreen] = useState(initialExam.requireFullscreen);
  const [detectFocusLoss, setDetectFocusLoss] = useState(initialExam.detectFocusLoss);
  const [blockClipboard, setBlockClipboard] = useState(initialExam.blockClipboard);
  const [recordDisconnects, setRecordDisconnects] = useState(initialExam.recordDisconnects);
  const [violationAction, setViolationAction] = useState(initialExam.violationAction);
  const [resultsDisplay, setResultsDisplay] = useState(initialExam.resultsDisplay);
  const [resultsWhen, setResultsWhen] = useState(initialExam.resultsWhen);
  const [status, setStatus] = useState<"draft" | "ready">(initialExam.status);
  const [questions, setQuestions] = useState<FullQuestion[]>(initialExam.questions);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saveState, setSaveState] = useState<"pending" | "loading" | "done">("done");
  const [saveError, setSaveError] = useState("");
  const [ready, setReady] = useState(false);
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const firstAutosave = useRef(true);

  const active = questions[activeIndex];
  const completionStates = useMemo(() => questions.map(getQuestionCompletion), [questions]);
  const totalPoints = useMemo(() => examTotalPoints(questions), [questions]);
  const blockingCount = completionStates.filter((state) => state !== "complete").length;
  const optionsIncomplete = questions.some(
    (question) => (question.type === "mc" || question.type === "ms") && question.config.options.some((option) => !option.text.trim()),
  );
  const canReady = blockingCount === 0 && !optionsIncomplete && title.trim().length >= 3 && Boolean(subject.trim());

  useEffect(() => {
    if (status === "ready" && !canReady) setStatus("draft");
  }, [canReady, status]);

  const addQuestion = useCallback(() => {
    setQuestions((current) => {
      const next = [...current, makeQuestion("mc", current.length)];
      setActiveIndex(next.length - 1);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.code === "Enter")) {
        event.preventDefault();
        addQuestion();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    setReady(true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [addQuestion]);

  const saveNow = useCallback(async (nextStatus = status) => {
    setSaveState("loading");
    setSaveError("");
    try {
      const response = await fetch(`/api/exams/${encodeURIComponent(initialExam.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: initialExam.id,
          title,
          subject,
          instructions,
          timeLimitS: Math.max(60, Math.round(timeLimit * 60)),
          shuffleQuestions,
          shuffleOptions,
          allowBackwards,
          showProgress,
          autoSubmit,
          allowReconnect,
          supervisionLevel,
          requireFullscreen,
          detectFocusLoss,
          blockClipboard,
          recordDisconnects,
          violationAction,
          resultsDisplay,
          resultsWhen,
          status: nextStatus,
          questions,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "No se pudo guardar");
      }
      if (window.location.pathname === "/evaluaciones/nueva") {
        window.history.replaceState(null, "", `/evaluaciones/${encodeURIComponent(initialExam.id)}`);
      }
      setSaveState("done");
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar");
      setSaveState("done");
      return false;
    }
  }, [allowBackwards, allowReconnect, autoSubmit, blockClipboard, detectFocusLoss, initialExam.id, instructions, questions, recordDisconnects, requireFullscreen, resultsDisplay, resultsWhen, showProgress, shuffleOptions, shuffleQuestions, status, subject, supervisionLevel, timeLimit, title, violationAction]);

  useEffect(() => {
    if (firstAutosave.current) {
      firstAutosave.current = false;
      return;
    }
    setSaveState("pending");
    setSaveError("");
    const timer = window.setTimeout(() => void saveNow(), 10_000);
    return () => window.clearTimeout(timer);
  }, [saveNow]);

  async function prepareRun() {
    if (!canReady || preparing) return;
    setPreparing(true);
    const saved = await saveNow("ready");
    if (!saved) {
      setPreparing(false);
      return;
    }
    setStatus("ready");
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examId: initialExam.id }),
    });
    const body = await response.json().catch(() => ({})) as { id?: string; error?: string };
    if (response.ok && body.id) window.location.assign(`/sesiones/${encodeURIComponent(body.id)}`);
    else {
      setSaveError(body.error ?? "No se pudo abrir la sala de espera");
      setPreparing(false);
    }
  }

  function updateActive(updater: (question: FullQuestion) => FullQuestion) {
    setQuestions((current) =>
      current.map((question, index) => (index === activeIndex ? updater(question) : question)),
    );
  }

  function changeType(type: QuestionType) {
    const replacement = makeQuestion(type, active.position);
    updateActive((question) => ({
      ...replacement,
      id: question.id,
      prompt: question.prompt,
      points: question.points,
    }));
  }

  function duplicateActive() {
    setQuestions((current) => {
      const duplicate = structuredClone(active);
      duplicate.id = id("q");
      if (duplicate.type === "mc" || duplicate.type === "ms") {
        const idMap = new Map<string, string>();
        duplicate.config.options = duplicate.config.options.map((option) => {
          const nextId = id("op");
          idMap.set(option.id, nextId);
          return { ...option, id: nextId };
        });
        if (duplicate.type === "mc") {
          duplicate.config.correctOptionId = idMap.get(duplicate.config.correctOptionId) ?? "";
        } else {
          duplicate.config.correctOptionIds = duplicate.config.correctOptionIds.flatMap((value) =>
            idMap.has(value) ? [idMap.get(value)!] : [],
          );
        }
      }
      const next = [...current];
      next.splice(activeIndex + 1, 0, duplicate);
      setActiveIndex(activeIndex + 1);
      return next.map((question, position) => ({ ...question, position }));
    });
  }

  function deleteActive() {
    if (questions.length === 1) return;
    setQuestions((current) =>
      current
        .filter((_, index) => index !== activeIndex)
        .map((question, position) => ({ ...question, position })),
    );
    setActiveIndex((current) => Math.max(0, Math.min(current, questions.length - 2)));
  }

  function moveQuestion(from: number, to: number) {
    if (from === to) return;
    setQuestions((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((question, position) => ({ ...question, position }));
    });
    setActiveIndex((current) => {
      if (current === from) return to;
      if (from < current && to >= current) return current - 1;
      if (from > current && to <= current) return current + 1;
      return current;
    });
  }

  function applyImport() {
    const parsed = parsePastedExam(importText);
    if (!parsed.length) return;
    setQuestions(parsed);
    setActiveIndex(0);
    setImportOpen(false);
    setImportText("");
  }

  function applySupervisionPreset(level: "normal" | "strict") {
    setSupervisionLevel(level);
    if (level === "normal") { setRequireFullscreen(false); setDetectFocusLoss(true); setBlockClipboard(false); setRecordDisconnects(true); setViolationAction("warn_and_record"); }
    else { setRequireFullscreen(true); setDetectFocusLoss(true); setBlockClipboard(true); setRecordDisconnects(true); setViolationAction("warn_and_record"); }
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.75rem)] flex-col bg-canvas" data-editor-ready={ready} inert={!ready}>
      <div className="border-b bg-paper">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-4 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <a href="/evaluaciones" className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-inset" aria-label="Volver a evaluaciones">
                <ArrowLeft className="size-4" />
              </a>
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">{status === "ready" ? "Evaluación lista" : "Borrador de evaluación"}</p>
                <h1 className="truncate text-lg font-semibold text-ink">{title || "Sin título"}</h1>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`inline-flex items-center gap-2 text-sm ${saveError ? "text-alert" : "text-ink-2"}`} aria-live="polite">
                {saveState === "pending" ? <span className="size-2 rounded-full bg-warn" aria-hidden="true" /> : <StatusBadge state={saveState} />}
                {saveError || (saveState === "pending" ? "Cambios sin guardar" : saveState === "loading" ? "Guardando…" : "Guardado")}
              </span>
              {saveState === "pending" ? <Button type="button" variant="outline" size="sm" onClick={() => void saveNow()}><Save data-icon="inline-start" />Guardar ahora</Button> : null}
              <Dialog><DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Settings2 data-icon="inline-start" />Configuración</Button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Configuración de la evaluación</DialogTitle><DialogDescription>Definí navegación, tiempo, supervisión y publicación de resultados.</DialogDescription></DialogHeader><div className="grid gap-6 py-2">
                <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_10rem_8rem]"><Field><FieldLabel htmlFor="exam-title">Título</FieldLabel><Input id="exam-title" value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field><FieldLabel htmlFor="exam-subject">Materia</FieldLabel><Input id="exam-subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></Field><Field><FieldLabel htmlFor="exam-time">Duración</FieldLabel><Input id="exam-time" type="number" min={1} max={360} value={timeLimit} onChange={(event) => setTimeLimit(Number(event.target.value))} /></Field></FieldGroup>
                <section><h3 className="text-sm font-semibold text-ink">Orden y navegación</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Toggle label="Mezclar preguntas" checked={shuffleQuestions} onChange={setShuffleQuestions} /><Toggle label="Mezclar respuestas" checked={shuffleOptions} onChange={setShuffleOptions} /><Toggle label="Permitir volver atrás" checked={allowBackwards} onChange={setAllowBackwards} /><Toggle label="Mostrar progreso" checked={showProgress} onChange={setShowProgress} /></div></section>
                <section><h3 className="text-sm font-semibold text-ink">Tiempo y entrega</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Toggle label="Entregar automáticamente al finalizar" checked={autoSubmit} onChange={setAutoSubmit} /><Toggle label="Permitir reconexión" checked={allowReconnect} onChange={setAllowReconnect} /></div></section>
                <section><h3 className="text-sm font-semibold text-ink">Supervisión</h3><div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant={supervisionLevel === "normal" ? "default" : "outline"} onClick={() => applySupervisionPreset("normal")}>Normal</Button><Button type="button" size="sm" variant={supervisionLevel === "strict" ? "default" : "outline"} onClick={() => applySupervisionPreset("strict")}>Estricto</Button><Button type="button" size="sm" variant={supervisionLevel === "custom" ? "default" : "outline"} onClick={() => setSupervisionLevel("custom")}>Personalizado</Button></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Toggle label="Requerir pantalla completa" checked={requireFullscreen} onChange={(value) => { setRequireFullscreen(value); setSupervisionLevel("custom"); }} /><Toggle label="Detectar cambio de pestaña/ventana" checked={detectFocusLoss} onChange={(value) => { setDetectFocusLoss(value); setSupervisionLevel("custom"); }} /><Toggle label="Bloquear copiar y pegar" checked={blockClipboard} onChange={(value) => { setBlockClipboard(value); setSupervisionLevel("custom"); }} /><Toggle label="Registrar desconexiones" checked={recordDisconnects} onChange={(value) => { setRecordDisconnects(value); setSupervisionLevel("custom"); }} /></div><Field className="mt-3"><FieldLabel>Al detectar una infracción</FieldLabel><Select value={violationAction} onValueChange={(value) => setViolationAction(value as typeof violationAction)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="warn_and_record">Advertir y registrar</SelectItem><SelectItem value="record_only">Solo registrar</SelectItem></SelectContent></Select></Field></section>
                <section><h3 className="text-sm font-semibold text-ink">Resultados</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field><FieldLabel>Mostrar</FieldLabel><Select value={resultsDisplay} onValueChange={(value) => setResultsDisplay(value as typeof resultsDisplay)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="score_only">Solo puntaje</SelectItem><SelectItem value="score_and_answers">Puntaje y respuestas</SelectItem><SelectItem value="hidden">No mostrar</SelectItem></SelectContent></Select></Field><Field><FieldLabel>Cuándo</FieldLabel><Select value={resultsWhen} onValueChange={(value) => setResultsWhen(value as typeof resultsWhen)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="teacher_publishes">Cuando el docente publique</SelectItem><SelectItem value="after_submit">Al entregar</SelectItem><SelectItem value="after_run">Al terminar la sesión</SelectItem></SelectContent></Select></Field></div></section>
              </div><DialogFooter><DialogClose asChild><Button type="button">Listo</Button></DialogClose></DialogFooter></DialogContent></Dialog>
              <Button type="button" disabled={!canReady || preparing} onClick={() => void prepareRun()}>
                {preparing ? "Preparando sala…" : "Preparar para el curso"}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="exam-instructions">Indicaciones para el alumno</FieldLabel>
            <Textarea
              id="exam-instructions"
              className="min-h-16"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Ej.: Leé cada consigna antes de responder."
            />
          </Field>
        </div>
      </div>

      <main id="contenido" className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-4 px-4 py-5 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge variant="outline">Pregunta {activeIndex + 1} de {questions.length}</Badge>
            <span className="mono-number text-sm font-semibold text-ink-2">{totalPoints} pt{totalPoints === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={duplicateActive}>
              <Copy data-icon="inline-start" /> Duplicar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={activeIndex === 0}
              onClick={() => moveQuestion(activeIndex, activeIndex - 1)}
              aria-label="Mover pregunta a la izquierda"
            >
              <GripVertical data-icon="inline-start" /> Mover
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={deleteActive} disabled={questions.length === 1} aria-label="Eliminar pregunta">
              <Trash2 />
            </Button>
          </div>
        </div>

        <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="question-heading">
          <div className="flex flex-col gap-6 p-5 md:p-7">
            <Field data-invalid={!active.prompt.trim() || undefined}>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="question-prompt" id="question-heading">Enunciado</FieldLabel>
                <span className="text-xs text-muted">La pregunta ocupa todo el ancho para que puedas leerla completa.</span>
              </div>
              <Textarea
                id="question-prompt"
                className="min-h-28 resize-y text-base leading-relaxed"
                value={active.prompt}
                aria-invalid={!active.prompt.trim()}
                onChange={(event) => updateActive((question) => ({ ...question, prompt: event.target.value }))}
                placeholder="Escribí el enunciado. Después elegís el tipo de respuesta."
                autoFocus
              />
              {!active.prompt.trim() ? <FieldError>Escribí el enunciado de la pregunta {activeIndex + 1}.</FieldError> : null}
            </Field>

            <Separator />

            <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
              <FieldGroup className="content-start gap-5">
                <Field>
                  <FieldLabel htmlFor="question-type">Tipo de respuesta</FieldLabel>
                  <Select value={active.type} onValueChange={(value) => changeType(value as QuestionType)}>
                    <SelectTrigger id="question-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.entries(TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>Podés cambiarlo sin perder el enunciado.</FieldDescription>
                </Field>
                <Field data-invalid={active.points <= 0 || undefined}>
                  <FieldLabel htmlFor="question-points">Puntaje</FieldLabel>
                  <Input
                    id="question-points"
                    type="number"
                    min={1}
                    max={1000}
                    className="mono-number"
                    value={active.points}
                    aria-invalid={active.points <= 0}
                    onChange={(event) => updateActive((question) => ({ ...question, points: Number(event.target.value) }))}
                  />
                </Field>
              </FieldGroup>

              <div className="min-w-0 rounded-md bg-inset p-4 md:p-5">
                <AnswerKeyEditor question={active} onChange={updateActive} />
              </div>
            </div>
          </div>
        </section>

        {!canReady ? (
          <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-white px-3 py-2.5 text-sm text-ink-2" role="status">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
            <span>
              {!title.trim() || !subject.trim()
                ? "Completá el título y la materia antes de preparar la evaluación."
                : optionsIncomplete
                  ? "Completá el texto de todas las opciones antes de preparar la evaluación."
                  : blockingCount === 1 ? "Falta completar 1 pregunta" : `Faltan completar ${blockingCount} preguntas`} {title.trim() && subject.trim() && !optionsIncomplete ? "antes de abrir la sala." : ""}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-ok" role="status">
            <Check className="size-4" aria-hidden="true" /> Todas las preguntas tienen clave y puntaje.
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t bg-paper/95 px-4 py-4 shadow-[0_-8px_24px_rgba(22,24,29,.04)] supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-sm lg:-mx-6 lg:px-6">
          <div className="mx-auto flex max-w-[1132px] flex-col gap-3">
            <QuestionNavigator
              states={completionStates}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              onAdd={addQuestion}
              onMove={moveQuestion}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <ClipboardPaste data-icon="inline-start" /> Importar desde texto
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Importar un examen escrito</DialogTitle>
                    <DialogDescription>
                      Pegá preguntas separadas por una línea en blanco. Si detectamos opciones A), B), C), las armamos como opción única y te pedimos marcar la clave.
                    </DialogDescription>
                  </DialogHeader>
                  <Field>
                    <FieldLabel htmlFor="import-text">Texto del examen</FieldLabel>
                    <Textarea
                      id="import-text"
                      className="min-h-72 font-mono text-sm"
                      value={importText}
                      onChange={(event) => setImportText(event.target.value)}
                      placeholder={"1. ¿Cuál es la capital?\nA) Rosario\nB) Buenos Aires\nC) Mendoza\n\n2. Explicá tu respuesta."}
                    />
                  </Field>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
                    <Button type="button" onClick={applyImport} disabled={!importText.trim()}>Proponer preguntas</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <span className="text-xs text-muted">Arrastrá las burbujas para reordenar. También podés usar “Mover”.</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function AnswerKeyEditor({
  question,
  onChange,
}: {
  question: FullQuestion;
  onChange: (updater: (question: FullQuestion) => FullQuestion) => void;
}) {
  if (question.type === "long") {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="font-semibold text-ink">Corrección manual</p>
        <p className="max-w-md text-sm leading-relaxed text-muted">El alumno escribe un desarrollo. Testra no asigna nota automática a este tipo de pregunta.</p>
      </div>
    );
  }

  if (question.type === "tf") {
    return (
      <FieldSet>
        <FieldLegend variant="label">Marcá la respuesta correcta</FieldLegend>
        <RadioGroup
          value={question.config.correct ? "true" : "false"}
          onValueChange={(value) => onChange((current) => current.type === "tf" ? { ...current, config: { correct: value === "true" } } : current)}
          className="grid gap-2 sm:grid-cols-2"
        >
          {[{ value: "true", label: "Verdadero" }, { value: "false", label: "Falso" }].map((item) => (
            <FieldLabel key={item.value} className="bg-paper">
              <Field orientation="horizontal">
                <RadioGroupItem value={item.value} />
                <span>{item.label}</span>
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
      </FieldSet>
    );
  }

  if (question.type === "sa") {
    return (
      <FieldSet>
        <FieldLegend variant="label">Respuestas aceptadas</FieldLegend>
        <FieldDescription>No distinguimos mayúsculas, tildes ni espacios repetidos.</FieldDescription>
        <FieldGroup className="gap-2">
          {question.config.accepted.map((accepted, index) => (
            <Field key={index} orientation="horizontal">
              <FieldLabel htmlFor={`accepted-${index}`} className="sr-only">Respuesta aceptada {index + 1}</FieldLabel>
              <Input
                id={`accepted-${index}`}
                value={accepted}
                placeholder={index === 0 ? "Ej.: clorofila" : "Otra forma válida"}
                onChange={(event) => onChange((current) => {
                  if (current.type !== "sa") return current;
                  const values = [...current.config.accepted];
                  values[index] = event.target.value;
                  return { ...current, config: { accepted: values } };
                })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={question.config.accepted.length === 1}
                aria-label={`Eliminar respuesta aceptada ${index + 1}`}
                onClick={() => onChange((current) => current.type === "sa" ? { ...current, config: { accepted: current.config.accepted.filter((_, currentIndex) => currentIndex !== index) } } : current)}
              >
                <Trash2 />
              </Button>
            </Field>
          ))}
        </FieldGroup>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange((current) => current.type === "sa" ? { ...current, config: { accepted: [...current.config.accepted, ""] } } : current)}>
          <Plus data-icon="inline-start" /> Otra respuesta
        </Button>
      </FieldSet>
    );
  }

  const single = question.type === "mc";
  return (
    <FieldSet>
      <FieldLegend variant="label">Opciones y clave</FieldLegend>
      <FieldDescription>{single ? "Seleccioná una respuesta correcta." : "Podés marcar más de una respuesta correcta."}</FieldDescription>
      <FieldGroup className="gap-2">
        {question.config.options.map((option, index) => {
          const checked = single
            ? question.config.correctOptionId === option.id
            : question.config.correctOptionIds.includes(option.id);
          return (
            <Field key={option.id} orientation="horizontal" className="rounded-md border bg-paper p-2.5">
              {single ? (
                <RadioGroup value={question.config.correctOptionId} onValueChange={(value) => onChange((current) => current.type === "mc" ? { ...current, config: { ...current.config, correctOptionId: value } } : current)}>
                  <RadioGroupItem value={option.id} aria-label={`Marcar opción ${index + 1} como correcta`} />
                </RadioGroup>
              ) : (
                <Checkbox
                  checked={checked}
                  aria-label={`Marcar opción ${index + 1} como correcta`}
                  onCheckedChange={(nextChecked) => onChange((current) => {
                    if (current.type !== "ms") return current;
                    const values = nextChecked
                      ? [...current.config.correctOptionIds, option.id]
                      : current.config.correctOptionIds.filter((value) => value !== option.id);
                    return { ...current, config: { ...current.config, correctOptionIds: values } };
                  })}
                />
              )}
              <FieldLabel htmlFor={`option-${option.id}`} className="sr-only">Opción {index + 1}</FieldLabel>
              <Input
                id={`option-${option.id}`}
                value={option.text}
                placeholder={`Opción ${index + 1}`}
                onChange={(event) => onChange((current) => {
                  if (current.type !== "mc" && current.type !== "ms") return current;
                  return {
                    ...current,
                    config: {
                      ...current.config,
                      options: current.config.options.map((currentOption) => currentOption.id === option.id ? { ...currentOption, text: event.target.value } : currentOption),
                    },
                  } as FullQuestion;
                })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={question.config.options.length <= 2}
                aria-label={`Eliminar opción ${index + 1}`}
                onClick={() => onChange((current) => {
                  if (current.type !== "mc" && current.type !== "ms") return current;
                  const options = current.config.options.filter((currentOption) => currentOption.id !== option.id);
                  if (current.type === "mc") return { ...current, config: { options, correctOptionId: current.config.correctOptionId === option.id ? "" : current.config.correctOptionId } };
                  return { ...current, config: { options, correctOptionIds: current.config.correctOptionIds.filter((value) => value !== option.id) } };
                })}
              >
                <Trash2 />
              </Button>
            </Field>
          );
        })}
      </FieldGroup>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange((current) => {
          if (current.type !== "mc" && current.type !== "ms") return current;
          return { ...current, config: { ...current.config, options: [...current.config.options, { id: id("op"), text: "" }] } } as FullQuestion;
        })}
      >
        <Plus data-icon="inline-start" /> Agregar opción
      </Button>
      {!checkedKey(question) ? <FieldError>Marcá cuál es la respuesta correcta.</FieldError> : null}
    </FieldSet>
  );
}

function checkedKey(question: FullQuestion) {
  if (question.type === "mc") return Boolean(question.config.correctOptionId);
  if (question.type === "ms") return question.config.correctOptionIds.length > 0;
  return true;
}
