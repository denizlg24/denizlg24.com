import type React from "react";
import { cn } from "@/lib/utils";

export const TimelineCard = ({
  item,
  className,
  children,
}: {
  item: {
    logo?: React.ReactNode;
    date: { from: string; to?: string };
    title: string;
    subtitle: string;
    topics: string[];
  };
  className?: string;
  children?: React.ReactNode;
}) => {
  return (
    <article className={cn("flex flex-row items-start gap-4", className)}>
      <div
        className={cn(
          "w-12 h-12 bg-accent shrink-0 overflow-hidden",
          item.logo && "bg-transparent",
        )}
      >
        {item.logo}
      </div>
      <div className="flex flex-col gap-0 items-start grow">
        <div className="flex flex-row items-center gap-1 justify-start text-xs text-muted-foreground">
          <p>{item.date.from}</p>
          <span className="w-2 h-px bg-foreground/75"></span>
          <p>{item.date.to || "Present"}</p>
        </div>
        <h1 className="text-lg font-semibold">{item.title}</h1>
        <h2 className="text-sm text-muted-foreground">{item.subtitle}</h2>
        <ul className="w-full list-disc list-inside">
          {item.topics.map((topic, idx) => (
            <li key={idx} className="text-sm text-foreground">
              {topic}
            </li>
          ))}
        </ul>
        {children}
      </div>
    </article>
  );
};
