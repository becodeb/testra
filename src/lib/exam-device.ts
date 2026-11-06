// Pantalla completa en tablets y celulares: no se pide. En iPad el propio sistema
// la cierra al tocar un cuadro de texto, en iPhone y en varias apps no existe, y
// exigirla dejaba al alumno trabado o llenaba el registro de salidas que no hizo.

interface DeviceEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
}

function currentDevice(): DeviceEnv {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  };
}

/**
 * El iPad se presenta como una Mac, y con teclado y trackpad puede decir que su
 * puntero es fino: por eso no alcanza con mirar el puntero. Una Mac de verdad no
 * tiene puntos táctiles.
 */
export function isTouchExamDevice(env: DeviceEnv = currentDevice()): boolean {
  if (/iPad|iPhone|iPod|Android/.test(env.userAgent)) return true;
  if (env.platform === "MacIntel" && env.maxTouchPoints > 1) return true;
  return env.coarsePointer;
}

/** Sin esto `requestFullscreen` no hace nada: pasa en navegadores integrados en apps. */
export function fullscreenApiAvailable(
  doc: { fullscreenEnabled?: boolean; documentElement: { requestFullscreen?: unknown } } = document,
): boolean {
  return typeof doc.documentElement.requestFullscreen === "function" && doc.fullscreenEnabled !== false;
}
