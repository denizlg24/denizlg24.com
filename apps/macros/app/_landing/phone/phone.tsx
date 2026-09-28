import type { ReactNode } from "react";

export type PhoneSize = "hero" | "feature";

/**
 * A generic modern iPhone drawn in CSS. `children` fill the 393 × 852 pt
 * screen edge to edge, so a real screenshot drops in as a single image.
 */
export function Phone({
  label,
  size = "feature",
  children,
}: {
  label: string;
  size?: PhoneSize;
  children: ReactNode;
}) {
  return (
    <div role="img" aria-label={label} className="phone" data-size={size}>
      <div className="phone-body">
        <div className="phone-frame">
          <span className="phone-button top-[128px] -left-[3px] h-[32px]" />
          <span className="phone-button top-[190px] -left-[3px] h-[62px]" />
          <span className="phone-button top-[266px] -left-[3px] h-[62px]" />
          <span className="phone-button top-[222px] -right-[3px] h-[96px]" />
          <div className="phone-bezel">
            <div className="phone-screen">
              {children}
              <div className="phone-island" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
