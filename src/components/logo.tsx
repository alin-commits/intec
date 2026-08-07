import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
  variant?: "color" | "white";
};

export function Logo({ className, priority, variant = "color" }: LogoProps) {
  return (
    <Image
      src={variant === "white" ? "/logo-intec-white.webp" : "/logo-intec.webp"}
      alt="Suministros Intec"
      width={2309}
      height={489}
      priority={priority}
      className={className}
    />
  );
}
