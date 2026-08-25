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
  "cierre-pestana": { title: "La página se cerró, recargó o quedó suspendida", what: "Testra recibió una señal de salida de la página.", normal: "En celulares y notebooks también puede deberse a suspensión o ahorro de batería.", review: "Compará el momento con la reconexión y el progreso guardado." },
  desconexion: { title: "La conexión se interrumpió", what: "Testra dejó de recibir señales durante unos segundos.", normal: "Wi-Fi inestable, suspensión o ahorro de batería son causas frecuentes.", review: "Mirá cuánto tardó en volver y si las respuestas siguieron guardándose normalmente." },
  "sesion-duplicada": { title: "La evaluación se abrió en otro lugar", what: "La misma participación tuvo dos conexiones al mismo tiempo.", normal: "Recargar o restaurar una pestaña puede superponer conexiones brevemente.", review: "Revisá si ambas conexiones coexistieron y qué otros cambios ocurrieron." },
  "cambio-ip": { title: "La conexión a internet cambió", what: "La dirección de la conexión fue distinta durante la evaluación.", normal: "Es habitual al cambiar de Wi-Fi a datos móviles, usar una red escolar o reconectarse.", review: "Una variación aislada es débil; mirá repeticiones y contexto." },
  "cambio-user-agent": { title: "Cambió el navegador o dispositivo", what: "La evaluación volvió a abrirse desde un entorno diferente.", normal: "Una actualización, modo privado o restauración del navegador puede explicarlo.", review: "Revisá si hubo un cambio real de equipo y en qué momento." },
  "cadencia-respuestas": { title: "Se respondieron varias preguntas en muy poco tiempo", what: "El servidor observó respuestas en preguntas distintas dentro de un intervalo breve.", normal: "Preguntas simples o respuestas ya preparadas pueden producir un ritmo rápido.", review: "Revisá las preguntas y respuestas concretas; el ritmo por sí solo no prueba nada." },
};

export function copyForIncident(type: string): IncidentCopy {
  return incidentCopy[type] ?? { title: "Actividad para revisar", what: "Testra registró un evento durante la evaluación.", normal: "Puede tener explicaciones normales según el dispositivo y el contexto.", review: "Revisá la secuencia completa y conversá con el alumno si hace falta." };
}
