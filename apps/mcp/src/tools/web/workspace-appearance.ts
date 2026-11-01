import type { McpServer } from "@modelcontextprotocol/server";
import {
  appearancePatchSchema,
  componentInputSchema,
  componentPatchSchema,
  PAGE_COVER_GRADIENTS,
  THEME_EFFECTS,
  THEME_FONTS,
  themeInputSchema,
  themePatchSchema,
  themeScheduleInputSchema,
  UI_NODE_TYPES,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const APPEARANCE = "/api/admin/workspace/appearance";
const THEMES = "/api/admin/workspace/themes";
const COMPONENTS = "/api/admin/workspace/components";
const themeId = z
  .string()
  .min(1)
  .max(64)
  .describe("Theme id: builtin:<slug> or a custom theme's id");
const componentId = z.string().min(1).max(64).describe("Component id");

export function registerWebWorkspaceAppearance(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_workspace_themes",
    title: "Web: workspace themes",
    description: `How desktop and web look. A theme sets colours (CSS colours: hex or rgb()/hsl()/oklch(); background, foreground, surface, muted, mutedForeground, accent, accentStrong and border are required, the rest derive), scheme light|dark, corner radius in rem, fonts (body/heading: ${THEME_FONTS.join(", ")}), an ambient effect (${THEME_EFFECTS.join(", ")}) with density 0–1, ornaments (icon values shown beside page titles and in the sidebar), an optional https background image, and optional extra CSS (no url() or @import). Built-in themes (id builtin:<slug>) are read-only: copy one with create. Appearance holds the theme that is on, a schedule of themes for date ranges (the latest-starting entry covering today wins), text scale, density, and per-module sidebar labels, icons and order. Clients pick changes up within a minute.`,
    actions: {
      appearance: action({
        description:
          "The appearance settings and every theme (built-ins first)",
        readOnly: true,
        run: () => api.web.get(APPEARANCE),
      }),
      list: action({
        description: "Every theme, built-ins first",
        readOnly: true,
        run: () => api.web.get(THEMES),
      }),
      get: action({
        description: "One theme",
        input: z.object({ id: themeId }),
        readOnly: true,
        run: ({ id }) => api.web.get(p`${THEMES}/${id}`),
      }),
      create: action({
        description:
          "A new theme; returns it with its id. Turn it on with activate, or schedule it",
        input: themeInputSchema,
        run: (body) => api.web.post(THEMES, body),
      }),
      update: action({
        description:
          "Merges into a custom theme: colours, fonts and effect merge per field; css, ornament and background replace",
        input: z.object({ id: themeId, ...themePatchSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) => api.web.patch(p`${THEMES}/${id}`, body),
      }),
      delete: action({
        description:
          "Deletes a custom theme and every schedule entry naming it; Sage takes over if it was on",
        input: z.object({ id: themeId }),
        destructive: true,
        run: ({ id }) => api.web.delete(p`${THEMES}/${id}`),
      }),
      activate: action({
        description:
          "Makes the theme the default; a schedule entry covering today still wins over it",
        input: z.object({ id: themeId }),
        idempotent: true,
        run: ({ id }) => api.web.patch(APPEARANCE, { themeId: id }),
      }),
      schedule: action({
        description:
          "Turns a theme on from `from` through `to` (YYYY-MM-DD, inclusive, the viewer's local days), e.g. a seasonal theme for the next two months",
        input: themeScheduleInputSchema,
        run: (body) => api.web.post(`${APPEARANCE}/schedule`, body),
      }),
      unschedule: action({
        description: "Removes one schedule entry by its id",
        input: z.object({ entryId: z.string().min(1) }),
        destructive: true,
        run: ({ entryId }) =>
          api.web.delete(p`${APPEARANCE}/schedule/${entryId}`),
      }),
      set_appearance: action({
        description:
          "Replaces the named appearance fields: themeId, schedule (whole list), textScale 0.8–1.3, density compact|default|comfortable, modules {<moduleId>: {label?, icon?}}, sectionOrder, moduleOrder. Read appearance first and send back what you keep",
        input: appearancePatchSchema,
        run: (body) => api.web.patch(APPEARANCE, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_workspace_components",
    title: "Web: workspace components",
    description: `Custom UI elements in a library, placed on pages with a block {type:'component', componentId, props?, height?} (web_workspace_blocks apply). kind 'spec' is a JSON tree rendered with the app's own primitives and theme — prefer it: nodes are {id, type, …} with type one of ${UI_NODE_TYPES.join(", ")}; stack/row/grid/card/list hold children; text, value, caption, href and max interpolate {{path}} against the data scope; repeat: '<path to array>' renders the children once per element as {{item.…}} / {{index}}; when: '<path>' (or '!path') shows a node conditionally; chart {kind: bar|line|area|pie, x, y[]} plots the array at value; countdown counts down to the date in value; icon values are icon:<lucide-name>[:color]; an image's href must be a literal https URL. kind 'html' is HTML/CSS/JS run in a sandboxed iframe with no network at all (no fetch, images only as data: URIs) and no same-origin: theme colours are CSS variables (--background, --foreground, --accent, --accent-strong, --surface, --muted, --border, --radius) and data is window.component.data, refreshed with a 'component:data' message; call component.resize(px) to fit. bindings feed the data scope by name: {kind:'view', name, view: <view query as in web_workspace_views>} gives {rows, total, totals, groups}; {kind:'records', name, refs} gives record summaries; {kind:'json', name, value} constant data. props declare values each placing block sets, read as {{props.<name>}}. Page covers for web_workspace_pages update style: an https image, color:<css colour> or gradient:<${PAGE_COVER_GRADIENTS.join("|")}>.`,
    actions: {
      list: action({
        description: "Every component: id, name, kind, who made it",
        readOnly: true,
        run: () => api.web.get(COMPONENTS),
      }),
      get: action({
        description: "One component with its spec or code, bindings and props",
        input: z.object({ id: componentId }),
        readOnly: true,
        run: ({ id }) => api.web.get(p`${COMPONENTS}/${id}`),
      }),
      create: action({
        description: "A new component; returns it with its id",
        input: componentInputSchema,
        run: (body) => api.web.post(COMPONENTS, body),
      }),
      update: action({
        description:
          "Replaces the named fields (spec, html, css, js, bindings and props each whole). Get first",
        input: z.object({ id: componentId, ...componentPatchSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) => api.web.patch(p`${COMPONENTS}/${id}`, body),
      }),
      delete: action({
        description:
          "Deletes a component; blocks placing it show as missing until removed",
        input: z.object({ id: componentId }),
        destructive: true,
        run: ({ id }) => api.web.delete(p`${COMPONENTS}/${id}`),
      }),
    },
  });
}
