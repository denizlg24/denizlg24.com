import type {
  MacrosRecipeBlock,
  MacrosRecipeInline,
} from "@repo/schemas/macros";
import type { ReactNode } from "react";
import styles from "./article.module.css";

/** Stored links were validated on save; this holds even for older rows. */
export function safeHref(href: string | undefined) {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function RichText({
  content,
}: {
  content: readonly MacrosRecipeInline[];
}) {
  return content.map((run, index) => {
    let node: ReactNode = run.text;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    const href = safeHref(run.href);
    if (href)
      node = (
        <a href={href} rel="nofollow ugc noopener noreferrer" target="_blank">
          {node}
        </a>
      );
    return <span key={index}>{node}</span>;
  });
}

export function RecipeBlocks({
  blocks,
  headingLevel = 2,
  fallbackAlt,
}: {
  blocks: readonly MacrosRecipeBlock[];
  headingLevel?: 2 | 3 | 4;
  fallbackAlt: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return blocks.map((block, index) => {
    const key = `${index}-${block.type}`;
    switch (block.type) {
      case "paragraph":
        return (
          <p key={key}>
            <RichText content={block.content} />
          </p>
        );
      case "heading":
        return (
          <Heading key={key} className={styles.blockHeading}>
            {block.text}
          </Heading>
        );
      case "quote":
        return (
          <blockquote key={key}>
            <RichText content={block.content} />
          </blockquote>
        );
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={key} className={styles.list}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <RichText content={item} />
              </li>
            ))}
          </List>
        );
      }
      case "image":
        return block.imageUrl ? (
          <figure key={key} className={styles.figure}>
            <img
              src={block.imageUrl}
              alt={block.caption || fallbackAlt}
              loading="lazy"
              decoding="async"
            />
            {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          </figure>
        ) : null;
    }
  });
}
