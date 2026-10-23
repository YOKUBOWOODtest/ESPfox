"use client";

import { useEffect, useState } from "react";

/**
 * Detecta si el dispositivo es móvil (touch + pantalla pequeña).
 * Se ejecuta solo en cliente para evitar mismatch de hidratación.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const hasTouch =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(hasTouch && isSmallScreen);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
}

/**
 * Hook para gestos multitáctiles en el canvas:
 * - Pinch to zoom
 * - Two-finger pan
 * Funciona junto con los gestos de puntero existentes.
 */
/**
 * Ref compartido para indicar si hay un gesto multi-touch activo.
 * Los handlers de React (onPointerDown, etc.) deben leer esto y salir temprano.
 */
export const multiTouchActiveRef = { current: false };

const MIN_SCALE = 0.05;
const MAX_SCALE = 50;

export function useTouchGestures(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  camera: React.MutableRefObject<{ x: number; y: number; scale: number }>,
  viewport: React.MutableRefObject<{ width: number; height: number; dpr: number }>,
  schedulePaint: () => void,
  enabled: boolean,
  onScaleChange?: (scale: number) => void,
) {
  useEffect(() => {
    if (!enabled || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let lastDistance = 0;
    let lastCenter = { x: 0, y: 0 };
    let isPinching = false;

    const getTouchDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const getTouchCenter = (touches: TouchList) => {
      if (touches.length < 2) return { x: 0, y: 0 };
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    };

    /**
     * Reads the two-finger gesture.
     *
     * Re-entering from a one-finger touch resets the baseline, so the board
     * does not jump when the second finger lands.
     */
    const startPinch = (touches: TouchList) => {
      isPinching = true;
      multiTouchActiveRef.current = true;
      lastDistance = Math.max(1, getTouchDistance(touches));
      lastCenter = getTouchCenter(touches);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        startPinch(e.touches);
        // Prevenir scroll nativo y que React reciba pointer events
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPinching) {
        // Two fingers can land after a one-finger touch started.
        if (e.touches.length >= 2) {
          startPinch(e.touches);
          e.preventDefault();
        }
        return;
      }

      if (e.touches.length < 2) {
        // Pinch terminado
        isPinching = false;
        multiTouchActiveRef.current = false;
        return;
      }

      e.preventDefault();

      const currentDistance = Math.max(1, getTouchDistance(e.touches));
      const currentCenter = getTouchCenter(e.touches);

      // Pan: the board follows the movement of the finger midpoint. Dividing
      // by scale keeps the content under the fingers, whatever the zoom.
      camera.current.x -= (currentCenter.x - lastCenter.x) / camera.current.scale;
      camera.current.y -= (currentCenter.y - lastCenter.y) / camera.current.scale;

      // Zoom: anchored at the current midpoint, so the point under the fingers
      // stays put while the distance changes.
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, camera.current.scale * (currentDistance / lastDistance)),
      );

      if (nextScale !== camera.current.scale) {
        const canvasRect = canvas.getBoundingClientRect();
        const screenX = currentCenter.x - canvasRect.left;
        const screenY = currentCenter.y - canvasRect.top;

        const worldBefore = {
          x: camera.current.x + screenX / camera.current.scale,
          y: camera.current.y + screenY / camera.current.scale,
        };

        camera.current.scale = nextScale;

        const worldAfter = {
          x: camera.current.x + screenX / camera.current.scale,
          y: camera.current.y + screenY / camera.current.scale,
        };

        camera.current.x += worldBefore.x - worldAfter.x;
        camera.current.y += worldBefore.y - worldAfter.y;
        onScaleChange?.(nextScale);
      }

      lastDistance = currentDistance;
      lastCenter = currentCenter;
      schedulePaint();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinching = false;
        multiTouchActiveRef.current = false;
      }
    };

    // Permitir touch-action: none en canvas pero manejar gestos nosotros
    canvas.style.touchAction = "none";

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
      canvas.style.touchAction = "";
      multiTouchActiveRef.current = false;
    };
  }, [canvasRef, camera, viewport, schedulePaint, enabled]);
}