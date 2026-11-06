import { describe, expect, it } from "vitest";

import { fullscreenApiAvailable, isTouchExamDevice } from "@/lib/exam-device";

const desktop = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", platform: "Win32", maxTouchPoints: 0, coarsePointer: false };
const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", platform: "MacIntel", maxTouchPoints: 0, coarsePointer: false };

describe("isTouchExamDevice", () => {
  it("no confunde una computadora con una tablet", () => {
    expect(isTouchExamDevice(desktop)).toBe(false);
    expect(isTouchExamDevice(mac)).toBe(false);
  });

  it("reconoce el iPad aunque se presente como Mac y tenga trackpad", () => {
    expect(isTouchExamDevice({ ...mac, maxTouchPoints: 5 })).toBe(true);
  });

  it("reconoce iPhone, Android y otras pantallas táctiles", () => {
    expect(isTouchExamDevice({ ...desktop, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isTouchExamDevice({ ...desktop, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X200)" })).toBe(true);
    expect(isTouchExamDevice({ ...desktop, coarsePointer: true })).toBe(true);
  });

  it("no toma por tablet a una notebook con pantalla táctil y mouse", () => {
    expect(isTouchExamDevice({ ...desktop, maxTouchPoints: 10 })).toBe(false);
  });
});

describe("fullscreenApiAvailable", () => {
  const requestFullscreen = () => undefined;

  it("exige que el navegador la tenga y la permita", () => {
    expect(fullscreenApiAvailable({ documentElement: { requestFullscreen }, fullscreenEnabled: true })).toBe(true);
    expect(fullscreenApiAvailable({ documentElement: {} })).toBe(false);
    expect(fullscreenApiAvailable({ documentElement: { requestFullscreen }, fullscreenEnabled: false })).toBe(false);
  });
});
