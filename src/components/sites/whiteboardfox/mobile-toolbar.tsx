"use client";

import { useState, useRef, useEffect } from "react";
import {
  UndoIcon,
  RedoIcon,
  EraserIcon,
  MoveIcon,
  SelectIcon,
  TrashIcon,
  PencilIcon,
  CogIcon,
} from "./board-icons";
import { DrawPanel } from "./draw-panel";
import { ImportMenu } from "./import-menu";
import { OptionsMenu } from "./options-menu";
import type { ImportedMedia } from "@/lib/board/imported";
import type { StrokeStyle, DrawStyle } from "@/lib/board/stroke";
import type { BoardSettings } from "./use-board-settings";
import type { Participant } from "./use-board";

type Tool = "draw" | "erase" | "move" | "select";

interface MobileToolbarProps {
  tool: Tool;
  setTool: (tool: Tool) => void;
  style: StrokeStyle;
  drawStyle: DrawStyle;
  setStyle: (style: StrokeStyle) => void;
  setDrawStyle: (drawStyle: DrawStyle) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  isHost: boolean;
  onImport: (media: ImportedMedia) => void;
  onToggleOptions: () => void;
  optionsOpen: boolean;
  drawPanelOpen: boolean;
  setDrawPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Props para OptionsMenu en móvil
  participants: Participant[];
  search: string;
  onSearchChange: (search: string) => void;
  settings: BoardSettings;
  onSettingsChange: (patch: Partial<BoardSettings>) => void;
  flipColors: boolean;
  onFlipColorsChange: (value: boolean) => void;
  /** Host-only moderation from the participants list. */
  onKick?: (participant: Participant) => void;
  onBan?: (participant: Participant) => void;
}

export function MobileToolbar({
  tool,
  setTool,
  style,
  drawStyle,
  setStyle,
  setDrawStyle,
  onUndo,
  onRedo,
  onClear,
  isHost,
  onImport,
  onToggleOptions,
  optionsOpen,
  drawPanelOpen,
  setDrawPanelOpen,
  participants,
  search,
  onSearchChange,
  settings,
  onSettingsChange,
  flipColors,
  onFlipColorsChange,
  onKick,
  onBan,
}: MobileToolbarProps) {
  const [showMore, setShowMore] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Cerrar menús al tocar fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  const toggleTool = (t: Tool) => {
    setTool(t);
    setDrawPanelOpen(false);
    setShowMore(false);
  };

  const handleDrawClick = () => {
    if (tool === "draw") {
      setDrawPanelOpen((open: boolean) => !open);
    } else {
      setTool("draw");
      setDrawPanelOpen(true);
    }
    setShowMore(false);
  };

  return (
    <div
      ref={toolbarRef}
      className="mobile-toolbar"
      data-testid="mobile-toolbar"
      role="toolbar"
      aria-label="Herramientas de dibujo"
    >
      <div className="mobile-toolbar-main">
        {/* Botón Undo/Redo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            type="button"
            className="mobile-tool-btn"
            onClick={onUndo}
            aria-label="Deshacer (Ctrl+Z)"
            data-testid="mobile-tool-undo"
            style={{ height: 28, minWidth: 48, flexDirection: "row", gap: 4 }}
          >
            <UndoIcon />
            <span className="mobile-tool-label">Undo</span>
          </button>
          <button
            type="button"
            className="mobile-tool-btn"
            onClick={onRedo}
            aria-label="Rehacer (Ctrl+Shift+Z)"
            data-testid="mobile-tool-redo"
            style={{ height: 28, minWidth: 48, flexDirection: "row", gap: 4 }}
          >
            <RedoIcon />
            <span className="mobile-tool-label">Redo</span>
          </button>
        </div>

        {/* Herramienta principal activa - grande y prominente */}
        <button
          type="button"
          className={`mobile-tool-btn primary ${tool === "draw" ? "active" : ""}`}
          onClick={handleDrawClick}
          aria-label={`Herramienta actual: ${tool === "draw" ? "Dibujar" : tool === "erase" ? "Borrar" : tool === "move" ? "Mover" : "Seleccionar"}`}
          aria-pressed={tool === "draw"}
          data-testid="mobile-tool-draw"
        >
          <PencilIcon fill={style.color} />
          <span className="mobile-tool-label">Dibujar</span>
        </button>

        {/* Botones de herramientas secundarias - scroll horizontal */}
        <div className="mobile-tool-scroll" role="group" aria-label="Otras herramientas">
          <button
            type="button"
            className={`mobile-tool-btn ${tool === "erase" ? "active" : ""}`}
            onClick={() => toggleTool("erase")}
            aria-label="Borrar trazos completos"
            aria-pressed={tool === "erase"}
            data-testid="mobile-tool-erase"
          >
            <EraserIcon />
            <span className="mobile-tool-label">Borrar</span>
          </button>

          <button
            type="button"
            className={`mobile-tool-btn ${tool === "move" ? "active" : ""}`}
            onClick={() => toggleTool("move")}
            aria-label="Mover vista (arrastrar con dos dedos también funciona)"
            aria-pressed={tool === "move"}
            data-testid="mobile-tool-move"
          >
            <MoveIcon />
            <span className="mobile-tool-label">Mover</span>
          </button>

          <button
            type="button"
            className={`mobile-tool-btn ${tool === "select" ? "active" : ""}`}
            onClick={() => toggleTool("select")}
            aria-label="Seleccionar y transformar trazos"
            aria-pressed={tool === "select"}
            data-testid="mobile-tool-select"
          >
            <SelectIcon />
            <span className="mobile-tool-label">Seleccionar</span>
          </button>
        </div>
      </div>

      <div className="mobile-toolbar-actions">
        {/* Import - usa el componente ImportMenu que ya tiene su botón */}
        <ImportMenu
          onImport={onImport}
          data-testid="mobile-tool-import"
        />

        {/* Options - panel lateral o bottom sheet */}
        <button
          type="button"
          className={`mobile-tool-btn ${optionsOpen ? "active" : ""}`}
          onClick={onToggleOptions}
          aria-label="Opciones de la pizarra"
          aria-expanded={optionsOpen}
          aria-pressed={optionsOpen}
          data-testid="mobile-tool-options"
        >
          <CogIcon />
          <span className="mobile-tool-label">Opciones</span>
        </button>

        {/* More menu - Clear, etc. */}
        <div className="mobile-more-menu">
          <button
            type="button"
            className="mobile-tool-btn more-trigger"
            onClick={() => setShowMore((s) => !s)}
            aria-label="Más opciones"
            aria-expanded={showMore}
            data-testid="mobile-tool-more"
          >
            <span className="mobile-tool-icon">⋯</span>
            <span className="mobile-tool-label">Más</span>
          </button>

          {showMore && (
            <div className="mobile-more-dropdown" role="menu">
              {isHost && (
                <button
                  type="button"
                  role="menuitem"
                  className="mobile-dropdown-item danger"
                  onClick={() => {
                    if (confirm("¿Borrar todo el contenido de la pizarra?")) {
                      onClear();
                    }
                    setShowMore(false);
                  }}
                  data-testid="mobile-tool-clear"
                >
                  <TrashIcon />
                  <span>Limpiar pizarra</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="mobile-dropdown-item"
                onClick={() => {
                  onToggleOptions();
                  setShowMore(false);
                }}
                data-testid="mobile-tool-settings"
              >
                <CogIcon />
                <span>Configuración</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Draw Panel como bottom sheet en móvil */}
      {drawPanelOpen && tool === "draw" && (
        <MobileDrawPanel
          style={style}
          drawStyle={drawStyle}
          onStyleChange={setStyle}
          onDrawStyleChange={setDrawStyle}
          onClose={() => setDrawPanelOpen(false)}
        />
      )}

      {/* Options Menu como bottom sheet en móvil */}
      {optionsOpen && (
        <MobileOptionsPanel
          onClose={onToggleOptions}
          participants={participants}
          search={search}
          onSearchChange={onSearchChange}
          settings={settings}
          onSettingsChange={onSettingsChange}
          flipColors={flipColors}
          onFlipColorsChange={onFlipColorsChange}
          isHost={isHost}
          onKick={onKick}
          onBan={onBan}
        />
      )}
    </div>
  );
}

/** Draw Panel adaptado para móvil - bottom sheet */
function MobileDrawPanel({
  style,
  drawStyle,
  onStyleChange,
  onDrawStyleChange,
  onClose,
}: {
  style: StrokeStyle;
  drawStyle: DrawStyle;
  onStyleChange: (style: StrokeStyle) => void;
  onDrawStyleChange: (drawStyle: DrawStyle) => void;
  onClose: () => void;
}) {
  return (
    <div className="mobile-bottom-sheet" role="dialog" aria-label="Opciones de dibujo">
      <div className="mobile-sheet-handle" aria-hidden="true" />
      <div className="mobile-sheet-header">
        <h3>Opciones de dibujo</h3>
        <button
          type="button"
          className="mobile-sheet-close"
          onClick={onClose}
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>
      <DrawPanel
        style={style}
        drawStyle={drawStyle}
        onStyleChange={onStyleChange}
        onDrawStyleChange={onDrawStyleChange}
        onClose={onClose}
      />
    </div>
  );
}

/** Options Panel adaptado para móvil - bottom sheet */
function MobileOptionsPanel({
  onClose,
  participants,
  search,
  onSearchChange,
  settings,
  onSettingsChange,
  flipColors,
  onFlipColorsChange,
  isHost,
  onKick,
  onBan,
}: {
  onClose: () => void;
  participants: Participant[];
  search: string;
  onSearchChange: (search: string) => void;
  settings: BoardSettings;
  onSettingsChange: (patch: Partial<BoardSettings>) => void;
  flipColors: boolean;
  onFlipColorsChange: (value: boolean) => void;
  isHost: boolean;
  onKick?: (participant: Participant) => void;
  onBan?: (participant: Participant) => void;
}) {
  return (
    <div className="mobile-bottom-sheet" role="dialog" aria-label="Opciones de la pizarra">
      <div className="mobile-sheet-handle" aria-hidden="true" />
      <div className="mobile-sheet-header">
        <h3>Opciones</h3>
        <button
          type="button"
          className="mobile-sheet-close"
          onClick={onClose}
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>
      <OptionsMenu
        participants={participants}
        search={search}
        onSearchChange={onSearchChange}
        onClose={onClose}
        settings={settings}
        onSettingsChange={onSettingsChange}
        flipColors={flipColors}
        onFlipColorsChange={onFlipColorsChange}
        isHost={isHost}
        onKick={onKick}
        onBan={onBan}
      />
    </div>
  );
}