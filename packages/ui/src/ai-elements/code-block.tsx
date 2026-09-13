"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, CSSProperties, HTMLAttributes } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type BundledLanguage,
  type BundledTheme,
  bundledLanguages,
  createHighlighter,
  type HighlighterGeneric,
  type ThemedToken,
} from "shiki";

import { Button } from "../button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select";
import { cn } from "../utils";
import { codeThemeDark, codeThemeLight } from "./code-theme";

type CodeLanguage = BundledLanguage | (string & {});

const isBundledLanguage = (language: string): language is BundledLanguage =>
  Object.hasOwn(bundledLanguages, language);

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

const hasFontStyle = (fontStyle: number | undefined, flag: number) =>
  fontStyle !== undefined && fontStyle > 0 && (fontStyle & flag) !== 0;

type TokenizedCode = {
  tokens: ThemedToken[][];
};

type KeyedToken = { token: ThemedToken; key: string };
type KeyedLine = { tokens: KeyedToken[]; key: string };

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
  lines.map((line, lineIdx) => ({
    key: `line-${lineIdx}`,
    tokens: line.map((token, tokenIdx) => ({
      key: `line-${lineIdx}-${tokenIdx}`,
      token,
    })),
  }));

const tokenStyle = (token: ThemedToken): CSSProperties => ({
  backgroundColor: token.bgColor,
  color: token.color,
  fontStyle: hasFontStyle(token.fontStyle, FONT_STYLE_ITALIC)
    ? "italic"
    : undefined,
  fontWeight: hasFontStyle(token.fontStyle, FONT_STYLE_BOLD)
    ? "bold"
    : undefined,
  textDecoration: hasFontStyle(token.fontStyle, FONT_STYLE_UNDERLINE)
    ? "underline"
    : undefined,
  ...token.htmlStyle,
});

const TokenSpan = ({ token }: { token: ThemedToken }) => (
  <span
    className="dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)!"
    style={tokenStyle(token)}
  >
    {token.content}
  </span>
);

const LINE_NUMBER_CLASSES = cn(
  "block",
  "before:content-[counter(line)]",
  "before:inline-block",
  "before:[counter-increment:line]",
  "before:w-6",
  "before:mr-3",
  "before:text-right",
  "before:text-muted-foreground/50",
  "before:font-mono",
  "before:select-none",
  "before:tabular-nums",
);

const LineSpan = ({
  keyedLine,
  showLineNumbers,
}: {
  keyedLine: KeyedLine;
  showLineNumbers: boolean;
}) => (
  <span className={showLineNumbers ? LINE_NUMBER_CLASSES : "block"}>
    {keyedLine.tokens.length === 0
      ? "\n"
      : keyedLine.tokens.map(({ token, key }) => (
          <TokenSpan key={key} token={token} />
        ))}
  </span>
);

let highlighterPromise: Promise<
  HighlighterGeneric<BundledLanguage, BundledTheme>
> | null = null;

const getHighlighter = () => {
  highlighterPromise ??= createHighlighter({
    langs: [],
    themes: [codeThemeLight, codeThemeDark],
  });
  return highlighterPromise;
};

const TOKEN_CACHE_LIMIT = 200;
const tokensCache = new Map<string, TokenizedCode>();
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();

const getTokensCacheKey = (code: string, language: string) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${code.length}:${start}:${end}`;
};

const cacheTokens = (key: string, value: TokenizedCode) => {
  tokensCache.set(key, value);
  if (tokensCache.size > TOKEN_CACHE_LIMIT) {
    const oldest = tokensCache.keys().next().value;
    if (oldest !== undefined) {
      tokensCache.delete(oldest);
    }
  }
};

const createRawTokens = (code: string): TokenizedCode => {
  let offset = 0;
  return {
    tokens: code.split("\n").map((line) => {
      const lineOffset = offset;
      offset += line.length + 1;
      return line === ""
        ? []
        : [{ color: "inherit", content: line, offset: lineOffset }];
    }),
  };
};

/**
 * Returns cached tokens synchronously, or null while Shiki loads; `callback`
 * receives the result once it is ready.
 */
export const highlightCode = (
  code: string,
  language: CodeLanguage,
  callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
  const key = getTokensCacheKey(code, language);
  const cached = tokensCache.get(key);
  if (cached) {
    return cached;
  }

  if (callback) {
    const set = subscribers.get(key) ?? new Set();
    set.add(callback);
    subscribers.set(key, set);
  }

  const lang = isBundledLanguage(language) ? language : "text";

  getHighlighter()
    .then(async (highlighter) => {
      if (lang !== "text") {
        await highlighter.loadLanguage(lang);
      }
      const result = highlighter.codeToTokens(code, {
        lang,
        themes: { light: codeThemeLight.name, dark: codeThemeDark.name },
      });
      const tokenized: TokenizedCode = { tokens: result.tokens };
      cacheTokens(key, tokenized);
      for (const notify of subscribers.get(key) ?? []) {
        notify(tokenized);
      }
      subscribers.delete(key);
    })
    .catch(() => {
      subscribers.delete(key);
    });

  return null;
};

const CodeBlockBody = memo(
  ({
    tokenized,
    showLineNumbers,
    className,
  }: {
    tokenized: TokenizedCode;
    showLineNumbers: boolean;
    className?: string;
  }) => {
    const keyedLines = useMemo(
      () => addKeysToTokens(tokenized.tokens),
      [tokenized.tokens],
    );

    return (
      <pre
        className={cn(
          "m-0 w-max min-w-full bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground",
          className,
        )}
      >
        <code
          className={cn(
            "font-mono",
            showLineNumbers &&
              "[counter-increment:line_0] [counter-reset:line]",
          )}
        >
          {keyedLines.map((keyedLine) => (
            <LineSpan
              key={keyedLine.key}
              keyedLine={keyedLine}
              showLineNumbers={showLineNumbers}
            />
          ))}
        </code>
      </pre>
    );
  },
  (prev, next) =>
    prev.tokenized === next.tokenized &&
    prev.showLineNumbers === next.showLineNumbers &&
    prev.className === next.className,
);

CodeBlockBody.displayName = "CodeBlockBody";

type CodeBlockContextValue = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextValue>({ code: "" });

export type CodeBlockContainerProps = HTMLAttributes<HTMLDivElement> & {
  language: string;
};

export const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}: CodeBlockContainerProps) => (
  <div
    data-slot="code-block"
    data-language={language}
    className={cn(
      "group/code-block relative w-full min-w-0 overflow-hidden rounded-md bg-surface text-foreground",
      className,
    )}
    style={{
      containIntrinsicSize: "auto 200px",
      contentVisibility: "auto",
      ...style,
    }}
    {...props}
  />
);

export const CodeBlockHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="code-block-header"
    className={cn(
      "flex h-8 items-center justify-between gap-2 border-b border-border/60 pr-1 pl-3 text-[11px] text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export const CodeBlockTitle = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="code-block-title"
    className={cn("flex min-w-0 items-center gap-1.5", className)}
    {...props}
  />
);

export const CodeBlockFilename = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    data-slot="code-block-filename"
    className={cn("truncate font-mono", className)}
    {...props}
  />
);

export const CodeBlockActions = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="code-block-actions"
    className={cn("flex shrink-0 items-center gap-0.5", className)}
    {...props}
  />
);

export type CodeBlockContentProps = {
  code: string;
  language: CodeLanguage;
  showLineNumbers?: boolean;
  className?: string;
};

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false,
  className,
}: CodeBlockContentProps) => {
  const rawTokens = useMemo(() => createRawTokens(code), [code]);
  const syncTokens = useMemo(
    () => highlightCode(code, language) ?? rawTokens,
    [code, language, rawTokens],
  );

  const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null);
  const asyncKeyRef = useRef({ code, language });

  if (
    asyncKeyRef.current.code !== code ||
    asyncKeyRef.current.language !== language
  ) {
    asyncKeyRef.current = { code, language };
    setAsyncTokens(null);
  }

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, language, (result) => {
      if (!cancelled) {
        setAsyncTokens(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div
      data-slot="code-block-content"
      className={cn("relative overflow-auto", className)}
    >
      <CodeBlockBody
        showLineNumbers={showLineNumbers}
        tokenized={asyncTokens ?? syncTokens}
      />
    </div>
  );
};

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: CodeLanguage;
  showLineNumbers?: boolean;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const contextValue = useMemo(() => ({ code }), [code]);

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <CodeBlockContainer className={className} language={language} {...props}>
        {children}
        <CodeBlockContent
          code={code}
          language={language}
          showLineNumbers={showLineNumbers}
        />
      </CodeBlockContainer>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef(0);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }
    if (isCopied) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, [code, onCopy, onError, timeout, isCopied]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      aria-label={isCopied ? "Copied" : "Copy code"}
      className={cn(
        "size-6 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent",
        className,
      )}
      onClick={copyToClipboard}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
};

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>;

export const CodeBlockLanguageSelector = (
  props: CodeBlockLanguageSelectorProps,
) => <Select {...props} />;

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const CodeBlockLanguageSelectorTrigger = ({
  className,
  ...props
}: CodeBlockLanguageSelectorTriggerProps) => (
  <SelectTrigger
    className={cn(
      "h-6! gap-1 border-none bg-transparent px-1.5 font-mono text-[11px] text-muted-foreground shadow-none hover:text-foreground dark:bg-transparent dark:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3",
      className,
    )}
    size="sm"
    {...props}
  />
);

export type CodeBlockLanguageSelectorValueProps = ComponentProps<
  typeof SelectValue
>;

export const CodeBlockLanguageSelectorValue = (
  props: CodeBlockLanguageSelectorValueProps,
) => <SelectValue {...props} />;

export type CodeBlockLanguageSelectorContentProps = ComponentProps<
  typeof SelectContent
>;

export const CodeBlockLanguageSelectorContent = ({
  align = "end",
  ...props
}: CodeBlockLanguageSelectorContentProps) => (
  <SelectContent align={align} {...props} />
);

export type CodeBlockLanguageSelectorItemProps = ComponentProps<
  typeof SelectItem
>;

export const CodeBlockLanguageSelectorItem = ({
  className,
  ...props
}: CodeBlockLanguageSelectorItemProps) => (
  <SelectItem className={cn("font-mono text-xs", className)} {...props} />
);
