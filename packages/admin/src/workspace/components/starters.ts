import type { ComponentInput } from "@repo/schemas";

/** Starting points for a new component; each is a complete, valid component. */
export const COMPONENT_STARTERS: { label: string; input: ComponentInput }[] = [
  {
    label: "Blank",
    input: {
      name: "Untitled component",
      kind: "spec",
      spec: {
        id: "root",
        type: "stack",
        gap: 2,
        children: [
          { id: "title", type: "heading", text: "Untitled", level: 2 },
        ],
      },
    },
  },
  {
    label: "Open tasks",
    input: {
      name: "Open tasks",
      kind: "spec",
      icon: "icon:list-todo",
      bindings: [
        {
          name: "tasks",
          kind: "view",
          view: {
            source: "kanban-cards",
            filters: [{ field: "done", op: "is", value: false }],
            sort: [{ field: "due", dir: "asc" }],
            limit: 8,
          },
        },
      ],
      spec: {
        id: "root",
        type: "card",
        gap: 2,
        children: [
          {
            id: "head",
            type: "heading",
            level: 3,
            icon: "icon:list-todo",
            text: "Open tasks",
            caption: "{{tasks.total}}",
          },
          {
            id: "list",
            type: "list",
            repeat: "tasks.rows",
            children: [
              {
                id: "row",
                type: "row",
                align: "between",
                children: [
                  { id: "title", type: "text", text: "{{item.title}}" },
                  {
                    id: "due",
                    type: "badge",
                    when: "item.due",
                    text: "{{item.due | date}}",
                    tone: "muted",
                  },
                ],
              },
            ],
          },
          {
            id: "none",
            type: "text",
            when: "!tasks.rows",
            tone: "muted",
            text: "—",
          },
        ],
      },
    },
  },
  {
    label: "Countdown",
    input: {
      name: "Countdown",
      kind: "spec",
      icon: "icon:hourglass",
      props: [
        { name: "date", label: "Date", type: "date", default: "2026-12-25" },
        {
          name: "label",
          label: "Label",
          type: "text",
          default: "until Christmas",
        },
      ],
      spec: {
        id: "root",
        type: "card",
        surface: "accent",
        align: "center",
        children: [
          { id: "icon", type: "icon", icon: "icon:gift:red", size: "lg" },
          {
            id: "count",
            type: "countdown",
            value: "{{props.date}}",
            text: "{{props.label}}",
            size: "xl",
          },
        ],
      },
    },
  },
  {
    label: "Stat row",
    input: {
      name: "Stats",
      kind: "spec",
      bindings: [
        {
          name: "cards",
          kind: "view",
          view: { source: "kanban-cards", limit: 1 },
        },
        {
          name: "notes",
          kind: "view",
          view: { source: "notes", limit: 1 },
        },
      ],
      spec: {
        id: "root",
        type: "grid",
        columns: 2,
        children: [
          {
            id: "a",
            type: "stat",
            text: "Cards",
            value: "{{cards.total | number}}",
          },
          {
            id: "b",
            type: "stat",
            text: "Notes",
            value: "{{notes.total | number}}",
          },
        ],
      },
    },
  },
  {
    label: "Chart",
    input: {
      name: "Chart",
      kind: "spec",
      bindings: [
        {
          name: "data",
          kind: "json",
          value: [
            { label: "Mon", value: 3 },
            { label: "Tue", value: 5 },
            { label: "Wed", value: 2 },
            { label: "Thu", value: 6 },
            { label: "Fri", value: 4 },
          ],
        },
      ],
      spec: {
        id: "root",
        type: "stack",
        children: [
          {
            id: "chart",
            type: "chart",
            value: "{{data}}",
            chart: { kind: "bar", x: "label", y: ["value"] },
          },
        ],
      },
    },
  },
  {
    label: "HTML",
    input: {
      name: "HTML component",
      kind: "html",
      height: 160,
      html: '<div class="box"><h2>Hello</h2><p id="out"></p></div>',
      css: ".box { padding: 12px; border-radius: var(--radius); background: var(--surface); }\nh2 { margin: 0 0 4px; color: var(--accent-strong); font-size: 16px; }",
      js: 'component.onData((data) => {\n  document.getElementById("out").textContent = `Today is ${data.today}`;\n});',
    },
  },
];
