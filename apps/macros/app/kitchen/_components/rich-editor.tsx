import type { MacrosRecipeBlock } from "@repo/schemas/macros";
import { Placeholder } from "@tiptap/extensions";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { blocksToDoc, docToBlocks, IMAGE_NODE } from "./editor-doc";
import { RecipeImage } from "./image-node";
import styles from "./kitchen.module.css";
import { pickImage, uploadRecipeImage } from "./upload";

function isWebLink(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function imageFiles(list: FileList | null | undefined) {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

export function RichEditor({
  initial,
  onChange,
  placeholder,
  label,
  onError,
}: {
  initial: readonly MacrosRecipeBlock[];
  onChange: (blocks: MacrosRecipeBlock[]) => void;
  placeholder: string;
  label: string;
  onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(0);
  const editorRef = useRef<Editor | null>(null);

  async function insertImages(files: File[]) {
    const editor = editorRef.current;
    if (!editor) return;
    for (const file of files) {
      setUploading((count) => count + 1);
      try {
        const uploaded = await uploadRecipeImage(file);
        editor
          .chain()
          .focus()
          .insertContent({
            type: IMAGE_NODE,
            attrs: {
              imageKey: uploaded.storageKey,
              src: uploaded.previewUrl,
              caption: "",
            },
          })
          .run();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Upload failed.");
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        heading: { levels: [2] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https"],
          isAllowedUri: (url) => isWebLink(url),
          shouldAutoLink: (url) => isWebLink(url),
          HTMLAttributes: { rel: "nofollow ugc noopener noreferrer" },
        },
      }),
      Placeholder.configure({ placeholder }),
      RecipeImage,
    ],
    content: blocksToDoc(initial),
    editorProps: {
      attributes: { class: styles.prose ?? "", "aria-label": label },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        void insertImages(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
    },
    onUpdate: ({ editor: updated }) => onChange(docToBlocks(updated.getJSON())),
  });

  return (
    <div className={styles.richEditor}>
      {editor ? (
        <>
          <SelectionMenu editor={editor} />
          <details className={styles.insertTools}>
            <summary className={styles.insertToggle}>
              <span aria-hidden="true">+</span> Insert
            </summary>
            <div
              className={styles.insertMenu}
              role="group"
              aria-label="Insert content"
            >
              <button
                type="button"
                onClick={async () => {
                  const file = await pickImage();
                  if (file) void insertImages([file]);
                }}
              >
                Photo
              </button>
              <button
                type="button"
                onClick={() =>
                  editor.chain().focus().setHeading({ level: 2 }).run()
                }
              >
                Heading
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                Numbered
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              >
                Quote
              </button>
            </div>
          </details>
        </>
      ) : null}
      <EditorContent editor={editor} />
      {uploading ? (
        <p className={styles.uploading} role="status">
          Uploading {uploading === 1 ? "photo" : `${uploading} photos`}…
        </p>
      ) : null}
    </div>
  );
}

function SelectionMenu({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  function applyLink() {
    const url = (linking ?? "").trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinking(null);
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!isWebLink(href)) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinking(null);
  }

  const mark = (
    name: string,
    text: string,
    run: () => void,
    attrs?: Record<string, unknown>,
  ) => (
    <button
      type="button"
      aria-pressed={editor.isActive(name, attrs)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {text}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      className={styles.bubble}
      shouldShow={({ editor: current, from, to }) =>
        from !== to && !current.isActive(IMAGE_NODE)
      }
    >
      {linking === null ? (
        <>
          {mark("bold", "B", () => editor.chain().focus().toggleBold().run())}
          {mark("italic", "i", () =>
            editor.chain().focus().toggleItalic().run(),
          )}
          {mark("link", "Link", () => {
            setInvalid(false);
            setLinking(editor.getAttributes("link").href ?? "");
          })}
          <span className={styles.bubbleRule} aria-hidden="true" />
          {mark(
            "heading",
            "H",
            () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
            { level: 2 },
          )}
          {mark("blockquote", "“", () =>
            editor.chain().focus().toggleBlockquote().run(),
          )}
        </>
      ) : (
        <form
          className={styles.linkForm}
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit click
            autoFocus
            type="text"
            inputMode="url"
            value={linking}
            aria-invalid={invalid || undefined}
            placeholder="Paste a link, then Enter"
            onChange={(event) => {
              setInvalid(false);
              setLinking(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setLinking(null);
            }}
          />
        </form>
      )}
    </BubbleMenu>
  );
}
