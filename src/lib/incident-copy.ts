export interface IncidentCopy {
  title: string;
  what: string;
  normal: string;
  review: string;
}

export const incidentCopy: Record<string, IncidentCopy> = {
  "cambio-de-pestana": { title: "La evaluación dejó de estar visible", what: "La persona cambió de pestaña, minimizó o pasó a otra aplicación.", normal: "También puede ocurrir por una notificación, un permiso o el bloqueo de pantalla.", review: "Revisá cuánto duró y si se repitió en preguntas concretas." },
  "ventana-sin-foco": { title: "Otra ventana tomó el control", what: "La ventana de Testra dejó de ser la ventana activa.", normal: "Un aviso del sistema, la barra de direcciones o una herramienta de accesibilidad pueden causarlo.", review: "Mirá la duración y la secuencia completa antes de sacar conclusiones." },
  "atajo-copiar-pegar": { title: "Se usó copiar, cortar o pegar", what: "El navegador informó una acción del portapapeles. Testra guarda la cantidad cuando está disponible, nunca el contenido.", normal: "Puede ser una edición accidental o una herramienta de accesibilidad.", review: "Revisá el tamaño, la pregunta activa y si hubo varias acciones seguidas." },
  "atajo-f12": { title: "Se presionó la tecla F12", what: "El navegador recibió esa tecla.", normal: "Presionarla no demuestra que se hayan abierto herramientas ni que se haya consultado información externa.", review: "Tomalo solamente como contexto junto con otros eventos." },
  "salida-pantalla-completa": { title: "Se salió de pantalla completa", what: "La evaluación dejó el modo de pantalla completa.", normal: "Escape, permisos o alertas del sistema también pueden cerrarlo.", review: "Revisá si fue breve, repetido y qué estaba resolviendo." },
  "manipulacion-de-supervision": { title: "Se alteró la supervisión desde el navegador", what: "Funciones del navegador que Testra usa para saber si la evaluación está a la vista fueron reemplazadas por código escrito en la página.", normal: "Una extensión que modifique la página puede producirlo, aunque es poco frecuente: no ocurre por usar el equipo de forma normal.", review: "Es de las señales más fuertes que registra Testra. Miralo junto al resto de la línea de tiempo y conversá con el alumno." },
  "cierre-pestana": { title: "La página se cerró, recargó o quedó suspendida", what: "Testra recibió una señal de salida de la página.", normal: "En celulares y notebooks también puede deberse a suspensión o ahorro de batería.", review: "Compará el momento con la reconexión y el progreso guardado." },
  desconexion: { title: "La conexión se interrumpió", what: "Testra dejó de recibir señales durante unos segundos.", normal: "Wi-Fi inestable, suspensión o ahorro de batería son causas frecuentes.", review: "Mirá cuánto tardó en volver y si las respuestas siguieron guardándose normalmente." },
  "sesion-duplicada": { title: "La evaluación se abrió en otro lugar", what: "La misma participación tuvo dos conexiones al mismo tiempo.", normal: "Recargar o restaurar una pestaña puede superponer conexiones brevemente.", review: "Revisá si ambas conexiones coexistieron y qué otros cambios ocurrieron." },
  "cambio-ip": { title: "La conexión a internet cambió", what: "La dirección de la conexión fue distinta durante la evaluación.", normal: "Es habitual al cambiar de Wi-Fi a datos móviles, usar una red escolar o reconectarse.", review: "Una variación aislada es débil; mirá repeticiones y contexto." },
  "cambio-user-agent": { title: "Cambió el navegador o dispositivo", what: "La evaluación volvió a abrirse desde un entorno diferente.", normal: "Una actualización, modo privado o restauración del navegador puede explicarlo.", review: "Revisá si hubo un cambio real de equipo y en qué momento." },
  "cadencia-respuestas": { title: "Ritmo de resolución inusual (registro histórico)", what: "Una versión anterior observó respuestas rápidas en preguntas distintas.", normal: "No indica copia ni distingue entre azar, preguntas simples o respuestas ya preparadas.", review: "Conservalo sólo como contexto histórico, nunca como evidencia aislada." },
  "ritmo-desarrollo": { title: "Varios desarrollos extensos en poco tiempo", what: "El servidor observó desarrollos distintos de al menos 80 caracteres dentro de un intervalo breve.", normal: "Puede haber explicaciones legítimas; el ritmo no demuestra una conducta.", review: "Revisá respuestas y contexto. Esta señal no forma parte de los avisos de integridad." },
};

export function copyForIncident(type: string): IncidentCopy {
  return incidentCopy[type] ?? { title: "Actividad para revisar", what: "Testra registró un evento durante la evaluación.", normal: "Puede tener explicaciones normales según el dispositivo y el contexto.", review: "Revisá la secuencia completa y conversá con el alumno si hace falta." };
}

/**
 * Qué se copió, en cantidad. Testra nunca guarda el contenido, así que el
 * tamaño es todo lo que hay —y aun así ayuda: no es lo mismo un desliz de tres
 * caracteres que un bloque entero.
 */
export function clipboardDetail(meta: Record<string, unknown> | undefined): string {
  if (!meta) return "";
  const accion = typeof meta.action === "string"
    ? { copy: "Copió", copiar: "Copió", cut: "Cortó", cortar: "Cortó", paste: "Pegó", pegar: "Pegó" }[meta.action] ?? null
    : null;
  const cantidad = typeof meta.characters === "number" ? `${meta.characters} caracteres` : null;
  if (meta.deteccion === "atajo") return `${accion ?? "Usó el atajo"} con el teclado; el navegador no informó cuánto.`;
  if (accion && cantidad) return `${accion} ${cantidad}.`;
  if (cantidad) return `${cantidad}.`;
  if (accion) return `${accion}, sin cantidad disponible.`;
  return "";
}
