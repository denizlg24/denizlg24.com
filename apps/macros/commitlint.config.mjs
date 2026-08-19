/** @type {import("@commitlint/types").UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "perf",
        "build",
        "ci",
        "style",
        "revert",
      ],
    ],
    "scope-case": [2, "always", "kebab-case"],
    "subject-case": [2, "always", "lower-case"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
    "body-leading-blank": [2, "always"],
    "body-bullet-style": [2, "always"],
  },
  plugins: [
    {
      rules: {
        "body-bullet-style": (parsed) => {
          if (!parsed.body) return [true]
          const lines = parsed.body.split("\n").filter((l) => l.trim() !== "")
          const offending = lines.filter((l) => !/^- \S/.test(l))
          if (offending.length === 0) return [true]
          return [
            false,
            `body lines must start with "- " (bullet). Offending: ${offending
              .map((l) => `"${l.slice(0, 40)}"`)
              .join(", ")}`,
          ]
        },
      },
    },
  ],
}
