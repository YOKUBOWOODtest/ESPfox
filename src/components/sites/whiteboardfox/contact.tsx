import { Column } from "./column";

export function Contact() {
  return (
    <div className="bg-white">
      <Column>
        <div
          className="mt-[20px] mr-0 mb-[10px] ml-[50px]"
          style={{
            backgroundImage: "url('/sites/whiteboardfox/speech-bubbles.png')",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right top",
            backgroundSize: "contain",
          }}
        >
          <h1 className="pt-[20px] pb-[10px] text-[48px] font-[100]">
            Questions or Comments?
          </h1>
          <div className="font-[300]" style={{ lineHeight: "160%" }}>
            To contact us email:
            <a
              href="mailto:support@whiteboardmod.com"
              className="mt-[15px] mr-0 mb-[20px] ml-0 block w-[300px] rounded-[3px] bg-brand-soft text-center text-[18px] text-white no-underline"
            >
              support@whiteboardmod.com
            </a>
          </div>
        </div>
      </Column>
    </div>
  );
}
