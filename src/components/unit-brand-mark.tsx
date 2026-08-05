import Image from "next/image";
import type { BusinessUnit } from "@/lib/types";

type UnitBrandMarkProps = {
  unit: Pick<BusinessUnit, "name" | "accent" | "logo">;
  size?: number;
  width?: number;
  height?: number;
};

export function UnitBrandMark({ unit, size = 42, width, height }: UnitBrandMarkProps) {
  const boxWidth = width ?? size;
  const boxHeight = height ?? size;
  if (unit.logo) {
    return (
      <span className="unit-brand-mark" style={{ width: boxWidth, height: boxHeight }}>
        <Image src={unit.logo} alt={unit.name} fill sizes={`${boxWidth}px`} style={{ objectFit: "contain" }} />
      </span>
    );
  }
  return (
    <span className="unit-monogram" style={{ background: unit.accent, width: boxWidth, height: boxHeight }}>
      {unit.name.charAt(0)}
    </span>
  );
}
