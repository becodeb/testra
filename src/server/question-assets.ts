import sharp, { type OutputInfo } from "sharp";

import type { Actor } from "@/server/actors";
import type { QuestionAsset } from "@/domain/exam";
import { db } from "@/server/db/client";
import { getExamCapabilities } from "@/server/exam-permissions";

export const MAX_QUESTION_IMAGE_BYTES = 5 * 1024 * 1024;

export async function storeQuestionImage(
  actor: Actor,
  examId: string,
  file: File,
): Promise<QuestionAsset> {
  const capabilities = await getExamCapabilities(examId, actor);
  if (!capabilities.edit) throw new Error("No tenés permiso para adjuntar imágenes");
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen");
  if (file.size <= 0 || file.size > MAX_QUESTION_IMAGE_BYTES) {
    throw new Error("La imagen debe pesar hasta 5 MB");
  }

  const input = Buffer.from(await file.arrayBuffer());
  let output: Buffer;
  let info: OutputInfo;
  try {
    ({ data: output, info } = await sharp(input, { failOn: "warning" })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new Error("La imagen está dañada o usa un formato no compatible");
  }
  if (!info.width || !info.height || info.width > 8000 || info.height > 8000) {
    throw new Error("La imagen tiene dimensiones no válidas");
  }

  const id = crypto.randomUUID();
  const name = sanitizeName(file.name || "imagen.webp");
  await db.prepare(
    `INSERT INTO question_assets
       (id, exam_id, uploader_id, original_name, mime_type, size_bytes, width, height, data, created_at)
     VALUES (?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?)`,
  ).bind(id, examId, actor.id, name, output.byteLength, info.width, info.height, output, Date.now()).run();
  return { id, name, mimeType: "image/webp", width: info.width, height: info.height };
}

export async function readQuestionImage(id: string) {
  return db.prepare(
    "SELECT original_name, mime_type, size_bytes, data FROM question_assets WHERE id = ?",
  ).bind(id).first<{ original_name: string; mime_type: string; size_bytes: number; data: Buffer }>();
}

function sanitizeName(name: string): string {
  return name.replace(/[\u0000-\u001f\\/]/g, "_").trim().slice(0, 180) || "imagen.webp";
}
