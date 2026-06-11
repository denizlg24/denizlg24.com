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
      className=" text-[15px] sm:text-[16px] md:text-[17px] leading-[24px] sm:leading-[26px] md:leading-[28px] text-foreground/90 mb-[24px] tracking-[-0.003em] break-words"
      {...props}
    />
  ),

  h1: ({ node, ...props }: any) => (
    <h1
      className=" text-[26px] sm:text-[32px] md:text-[38px] font-bold font-calistoga lowercase text-foreground tracking-[-0.022em] leading-[1.1] mt-[36px] sm:mt-[40px] md:mt-[44px] mb-[8px]"
      {...props}
    />
  ),
  h2: ({ node, ...props }: any) => (
    <h2
      className=" text-[22px] sm:text-[26px] md:text-[30px] font-bold font-calistoga lowercase text-foreground tracking-[-0.022em] leading-[1.15] mt-[28px] sm:mt-[32px] md:mt-[36px] mb-[8px]"
      {...props}
    />
  ),
  h3: ({ node, ...props }: any) => (
    <h3
      className=" text-[19px] sm:text-[22px] md:text-[26px] font-bold font-calistoga lowercase text-foreground tracking-[-0.019em] leading-[1.2] mt-[24px] sm:mt-[26px] md:mt-[28px] mb-[8px]"
      {...props}
    />
  ),
  h4: ({ node, ...props }: any) => (
    <h4
      className=" text-[17px] sm:text-[19px] md:text-[22px] font-bold font-calistoga lowercase text-foreground tracking-[-0.015em] leading-[1.22] mt-[18px] sm:mt-[20px] md:mt-[22px] mb-[8px]"
      {...props}
    />
  ),
  h5: ({ node, ...props }: any) => (
    <h5
      className=" text-[16px] sm:text-[17px] md:text-[18px] font-semibold font-calistoga lowercase text-foreground tracking-[-0.012em] leading-[1.25] mt-[16px] sm:mt-[17px] md:mt-[18px] mb-[8px]"
      {...props}
    />
  ),
  h6: ({ node, ...props }: any) => (
    <h6
      className=" text-[15px] sm:text-[15px] md:text-[16px] font-semibold font-calistoga lowercase text-foreground tracking-[-0.01em] leading-[1.3] mt-[14px] sm:mt-[14px] md:mt-[16px] mb-[8px]"
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
      className="border-l-[3px] border-foreground/80 pl-[23px] ml-0 mr-0 my-[24px] italic  text-[16px] sm:text-[17px] md:text-[18px] leading-[26px] sm:leading-[28px] md:leading-[30px] text-foreground/80"
      {...props}
    />
  ),

  ul: ({ node, ...props }: any) => (
    <ul
      className="list-disc list-outside ml-[30px] mb-[24px]  text-[15px] sm:text-[16px] md:text-[17px] leading-[24px] sm:leading-[26px] md:leading-[28px] text-foreground/90"
      {...props}
    />
  ),
  ol: ({ node, ...props }: any) => (
    <ol
      className="list-decimal list-outside ml-[30px] mb-[24px]  text-[15px] sm:text-[16px] md:text-[17px] leading-[24px] sm:leading-[26px] md:leading-[28px] text-foreground/90"
      {...props}
    />
  ),
  li: ({ node, ...props }: any) => (
    <li className="mb-[10px] pl-[5px]" {...props} />
  ),

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
        className="bg-muted/50 text-foreground px-[6px] py-[3px] rounded-[3px] text-[14px] sm:text-[15px] md:text-[15px] font-mono border border-border/40"
        {...props}
      >
        {children}
      </code>
    );
  },

  pre: ({ node, children, ...props }: any) => (
    <pre
      className="bg-muted/30 border border-border/40 rounded-lg overflow-x-auto my-[24px] text-[13px] sm:text-[14px] md:text-[14px] leading-[1.6] [&>code]:block [&>code]:p-4 [&>code]:overflow-x-auto"
      {...props}
    >
      {children}
    </pre>
  ),

  img: ({ node, ...props }: any) => (
    <img
      className="w-full h-auto my-[42px] mx-auto rounded-[4px]"
      loading="lazy"
      {...props}
    />
  ),

  hr: ({ node, ...props }: any) => (
    <div className="flex items-center justify-center my-[42px] gap-[8px]">
      <span className="w-[6px] h-[6px] rounded-full bg-foreground/40" />
      <span className="w-[6px] h-[6px] rounded-full bg-foreground/40" />
      <span className="w-[6px] h-[6px] rounded-full bg-foreground/40" />
    </div>
  ),

  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-[29px]">
      <table
        className="min-w-full text-left text-[14px] sm:text-[15px] md:text-[16px] border-collapse"
        {...props}
      />
    </div>
  ),
  th: ({ node, ...props }: any) => (
    <th
      className=" font-semibold p-[10px] sm:p-[11px] md:p-[12px] border-b-[2px] border-border text-foreground"
      {...props}
    />
  ),
  td: ({ node, ...props }: any) => (
    <td
      className=" p-[10px] sm:p-[11px] md:p-[12px] border-b border-border/40 text-foreground/90"
      {...props}
    />
  ),

  strong: ({ node, ...props }: any) => (
    <strong className="font-bold text-foreground" {...props} />
  ),

  em: ({ node, ...props }: any) => <em className="italic" {...props} />,

  parameter: ({ node, children, ...props }: any) => (
    <code
      className="bg-muted/50 text-foreground px-[6px] py-[3px] rounded-[3px] text-[14px] sm:text-[15px] md:text-[15px] font-mono border border-border/40"
      {...props}
    >
      {children}
    </code>
  ),
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({
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
