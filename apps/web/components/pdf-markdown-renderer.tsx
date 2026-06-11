import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { StyledLink } from "./styled-link";

const MediumStyleComponents = {
  p: ({ node, ...props }: any) => (
    <p
      className=" text-[11px] leading-[18px] text-foreground/90 mb-[12px] tracking-[-0.003em] break-words"
      {...props}
    />
  ),

  h1: ({ node, ...props }: any) => (
    <h1
      className=" text-[18px] font-bold text-foreground font-calistoga lowercase tracking-[-0.022em] leading-[1.1] mt-[16px] mb-[6px]"
      {...props}
    />
  ),
  h2: ({ node, ...props }: any) => (
    <h2
      className=" text-[16px] font-bold text-foreground font-calistoga lowercase tracking-[-0.022em] leading-[1.15] mt-[14px] mb-[6px]"
      {...props}
    />
  ),
  h3: ({ node, ...props }: any) => (
    <h3
      className=" text-[14px] font-bold text-foreground font-calistoga lowercase tracking-[-0.019em] leading-[1.2] mt-[12px] mb-[5px]"
      {...props}
    />
  ),
  h4: ({ node, ...props }: any) => (
    <h4
      className=" text-[13px] font-bold text-foreground font-calistoga lowercase tracking-[-0.015em] leading-[1.22] mt-[10px] mb-[5px]"
      {...props}
    />
  ),
  h5: ({ node, ...props }: any) => (
    <h5
      className=" text-[12px] font-semibold text-foreground font-calistoga lowercase tracking-[-0.012em] leading-[1.25] mt-[9px] mb-[5px]"
      {...props}
    />
  ),
  h6: ({ node, ...props }: any) => (
    <h6
      className=" text-[11px] font-semibold text-foreground font-calistoga lowercase tracking-[-0.01em] leading-[1.3] mt-[8px] mb-[4px]"
      {...props}
    />
  ),

  a: ({ node, children, ...props }: any) => {
    const hasImage = node.children?.some(
      (child: any) => child.type === "element" && child.tagName === "img",
    );

    if (hasImage) {
      return (
        <a
          {...props}
          className="inline-block hover:opacity-90 transition-opacity"
        >
          {children}
        </a>
      );
    }

    return (
      <StyledLink type="anchor" className="text-foreground" {...props}>
        {children}
      </StyledLink>
    );
  },

  blockquote: ({ node, ...props }: any) => (
    <blockquote
      className="border-l-[2px] border-foreground/80 pl-3 ml-0 mr-0 my-3 italic  text-[11px] leading-[18px] text-foreground/80"
      {...props}
    />
  ),

  ul: ({ node, ...props }: any) => (
    <ul
      className="list-disc list-outside ml-5 mb-3  text-[11px] leading-[18px] text-foreground/90"
      {...props}
    />
  ),
  ol: ({ node, ...props }: any) => (
    <ol
      className="list-decimal list-outside ml-5 mb-3  text-[11px] leading-[18px] text-foreground/90"
      {...props}
    />
  ),
  li: ({ node, ...props }: any) => <li className="mb-1 pl-1" {...props} />,

  code: ({ node, className, children, ...props }: any) => {
    // Check if this is inside a pre tag (code block) - rehype-pretty-code handles these
    const isCodeBlock = className?.includes("language-");

    if (isCodeBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    // Inline code styling
    return (
      <code
        className="bg-muted/50 text-foreground px-1 py-0.5 rounded-sm text-[10px] font-mono border border-border/40"
        {...props}
      >
        {children}
      </code>
    );
  },

  pre: ({ node, children, ...props }: any) => (
    <pre
      className="bg-muted/30 border border-border/40 rounded-md overflow-x-auto my-3 text-[10px] leading-[1.5] [&>code]:block [&>code]:p-2 [&>code]:overflow-x-auto"
      {...props}
    >
      {children}
    </pre>
  ),

  img: ({ node, ...props }: any) => (
    <img
      className="w-full h-auto my-4 mx-auto rounded-sm"
      loading="lazy"
      {...props}
    />
  ),

  hr: ({ node, ...props }: any) => (
    <div className="flex items-center justify-center my-4 gap-2">
      <span className="w-1 h-1 rounded-full bg-foreground/40" />
      <span className="w-1 h-1 rounded-full bg-foreground/40" />
      <span className="w-1 h-1 rounded-full bg-foreground/40" />
    </div>
  ),

  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-3">
      <table
        className="min-w-full text-left text-[10px] border-collapse"
        {...props}
      />
    </div>
  ),
  th: ({ node, ...props }: any) => (
    <th
      className=" font-semibold p-2 border-b-2 border-border text-foreground"
      {...props}
    />
  ),
  td: ({ node, ...props }: any) => (
    <td
      className=" p-2 border-b border-border/40 text-foreground/90"
      {...props}
    />
  ),

  strong: ({ node, ...props }: any) => (
    <strong className="font-bold text-foreground" {...props} />
  ),

  em: ({ node, ...props }: any) => <em className="italic" {...props} />,
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function PDFMarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  return (
    <article
      className={cn(
        "w-full max-w-full mx-auto [&>*:first-child]:mt-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeRaw, { passThrough: ["math", "inlineMath"] }],
          rehypeKatex,
          rehypeHighlight,
        ]}
        components={MediumStyleComponents}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
