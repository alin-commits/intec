import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
};

export function Logo({ className, priority }: LogoProps) {
  return (
    <Image
      src="/logo-intec.webp"
      alt="Suministros Intec"
      width={2309}
      height={489}
      priority={priority}
      className={className}
    />
  );
}
