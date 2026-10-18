import {
  mergeAttributes,
  Node,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { IMAGE_NODE } from "./editor-doc";
import styles from "./kitchen.module.css";

function ImageView({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: ReactNodeViewProps) {
  const src = typeof node.attrs.src === "string" ? node.attrs.src : null;
  const caption =
    typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  return (
    <NodeViewWrapper
      className={styles.imageNode}
      data-selected={selected || undefined}
    >
      <figure contentEditable={false}>
        {src ? (
          <img src={src} alt={caption} />
        ) : (
          <div className={styles.imagePending} />
        )}
        <input
          className={styles.caption}
          value={caption}
          maxLength={500}
          placeholder="Caption (optional)"
          onChange={(event) =>
            updateAttributes({ caption: event.target.value })
          }
        />
        <button
          type="button"
          className={styles.imageRemove}
          onClick={deleteNode}
        >
          Remove
        </button>
      </figure>
    </NodeViewWrapper>
  );
}

/**
 * The only image the editor knows. It has no parseHTML rule, so a pasted
 * <img> from anywhere is dropped instead of hotlinking a foreign URL.
 */
export const RecipeImage = Node.create({
  name: IMAGE_NODE,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      imageKey: { default: null },
      src: { default: null },
      caption: { default: "" },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes({ "data-recipe-image": "" }, HTMLAttributes),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
