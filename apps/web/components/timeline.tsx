import { cn } from "@/lib/utils";

export const Timeline = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => {
  return (
    <div className={cn("w-full flex flex-col py-4 gap-6 relative", className)}>
      {children}
      <div className="absolute w-px bottom-0 bg-foreground left-6 top-0 -z-10"></div>
    </div>
  );
};
