import Image from "next/image";
import { Column } from "./column";

const FEATURES = [
  {
    image: "/sites/whiteboardfox/users-circle-x2.png",
    title: "Easy to Share",
    body: "Just email a link to the web page to let others view and edit your whiteboard.",
    margin: "mr-[20px]",
  },
  {
    image: "/sites/whiteboardfox/thunder-circle-x2.png",
    title: "Fast Syncing",
    body: "Changes you make are relayed to other participants within a few seconds.",
    margin: "mx-[20px]",
  },
  {
    image: "/sites/whiteboardfox/tablet-circle-x2.png",
    title: "Tablet Friendly",
    body: "Use pinch-to-zoom gestures and your tablet's stylus pen if available.",
    margin: "ml-[20px]",
  },
];

export function Features() {
  return (
    <div className="bg-brand-soft">
      <Column className="bg-brand-soft text-white">
        <div className="px-[50px] pt-[30px] pb-[50px] text-[16px] font-[100]">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className={`inline-block w-[277px] text-center align-top ${feature.margin}`}
            >
              <Image
                src={feature.image}
                alt=""
                width={76}
                height={76}
                className="inline"
              />
              <h3 className="py-[10px] text-[26px]/[normal] font-[100]">{feature.title}</h3>
              {feature.body}
            </div>
          ))}
        </div>
      </Column>
    </div>
  );
}
