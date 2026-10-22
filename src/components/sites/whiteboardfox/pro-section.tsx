"use client";

import Link from "next/link";
import { Column } from "./column";
import { activatePro, usePro } from "./use-pro";
import { WHITEBOARDMOD_NAME } from "./site-header";

const CARD =
  "rounded-[6px] border border-solid border-[#e5e5e5] bg-white p-[20px] shadow-sm";

const LIST = ["Whiteboards ilimitados", "Sin publicidad", "Historial completo", "Exportar e importar"];

/**
 * Free Pro activation. There is no plan picker, no pricing table and no payment
 * gateway: one click turns every Pro feature on for this device.
 */
export function ProSection() {
  const pro = usePro();

  return (
    <Column>
      <div className="px-[50px] py-[50px]">
        <h1 className="pb-[10px] text-[48px] font-[100]">Activa tu pro</h1>
        <p className="max-w-[700px] text-[20px]" style={{ lineHeight: "160%" }}>
          {WHITEBOARDMOD_NAME} Pro es <strong>gratis</strong>. No hay planes, ni
          periodos de prueba, ni pasarelas de pago: pulsa el botón y todas las
          funciones Pro quedan activadas en este dispositivo.
        </p>

        <div className="mt-[24px] flex flex-wrap items-stretch gap-[20px]">
          <div className={`w-[470px] ${CARD}`}>
            <h2 className="pb-[10px] text-[26px] font-[100]">Qué incluye</h2>
            <ul className="text-[18px]" style={{ lineHeight: "180%" }}>
              {LIST.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>

          <div className={`w-[470px] ${CARD}`} data-testid="pro-status-card">
            <h2 className="pb-[10px] text-[26px] font-[100]">Estado</h2>
            <p className="text-[18px]" data-testid="pro-status">
              {pro ? "Pro activo en este dispositivo" : "Todavía no está activo"}
            </p>

            <div className="mt-[16px]">
              {pro ? (
                <p className="text-[18px] text-brand-soft">
                  Ya tienes todas las funciones Pro disponibles.
                </p>
              ) : (
                <button
                  type="button"
                  id="activateProButton"
                  onClick={activatePro}
                  className="inline-block cursor-pointer rounded-[5px] bg-[#ff6a00] px-[30px] py-[12px] text-center text-[22px] font-[300] whitespace-nowrap text-white"
                  style={{ fontFamily: "Roboto, sans-serif" }}
                >
                  Activar funciones Pro
                </button>
              )}
            </div>

            <p className="mt-[16px] text-[16px] text-brand-soft">
              Empieza a dibujar en{" "}
              <Link href="/" className="underline">
                la página principal
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </Column>
  );
}
