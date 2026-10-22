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
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        // @ts-ignore
        navigator.msMaxTouchPoints > 0;
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

export function useTouchGestures(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  camera: React.MutableRefObject<{ x: number; y: number; scale: number }>,
  viewport: React.MutableRefObject<{ width: number; height: number; dpr: number }>,
  schedulePaint: () => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !canvasRef.current) return;

    const canvas = canvasRef.current;
    let initialDistance = 0;
    let initialScale = 1;
    let initialCenter = { x: 0, y: 0 };
    let initialCamera = { x: 0, y: 0, scale: 1 };
    let isPinching = false;
    let lastTwoFingerCenter = { x: 0, y: 0 };

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

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // Iniciar pinch zoom o two-finger pan
        isPinching = true;
        multiTouchActiveRef.current = true;
        initialDistance = getTouchDistance(e.touches);
        initialScale = camera.current.scale;
        initialCenter = getTouchCenter(e.touches);
        initialCamera = { ...camera.current };
        lastTwoFingerCenter = initialCenter;

        // Prevenir scroll nativo y que React reciba pointer events
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPinching) {
        // Detectar two-finger pan (iniciado después de un touch)
        if (e.touches.length >= 2) {
          isPinching = true;
          multiTouchActiveRef.current = true;
          initialDistance = getTouchDistance(e.touches);
          initialScale = camera.current.scale;
          initialCenter = getTouchCenter(e.touches);
          initialCamera = { ...camera.current };
          lastTwoFingerCenter = initialCenter;
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

      const currentDistance = getTouchDistance(e.touches);
      const currentCenter = getTouchCenter(e.touches);

      // Calcular zoom
      const scaleFactor = currentDistance / initialDistance;
      let newScale = initialScale * scaleFactor;

      // Clamp scale
      const MIN_SCALE = 0.05;
      const MAX_SCALE = 50;
      newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));

      if (newScale === camera.current.scale) return;

      // Zoom anclado al centro de los dos dedos (en coordenadas de pantalla)
      const canvasRect = canvas.getBoundingClientRect();
      const screenX = currentCenter.x - canvasRect.left;
      const screenY = currentCenter.y - canvasRect.top;

      // Punto mundial bajo el centro antes del zoom
      const worldBefore = {
        x: camera.current.x + screenX / camera.current.scale,
        y: camera.current.y + screenY / camera.current.scale,
      };

      // Aplicar nuevo scale
      camera.current.scale = newScale;

      // Punto mundial bajo el centro después del zoom
      const worldAfter = {
        x: camera.current.x + screenX / camera.current.scale,
        y: camera.current.y + screenY / camera.current.scale,
      };

      // Ajustar cámara para que el punto mundial se quede bajo los dedos
      camera.current.x += worldBefore.x - worldAfter.x;
      camera.current.y += worldBefore.y - worldAfter.y;

      schedulePaint();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinching = false;
        multiTouchActiveRef.current = false;
      } else {
        // Recalcular centro si un dedo se levantó
        lastTwoFingerCenter = getTouchCenter(e.touches);
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