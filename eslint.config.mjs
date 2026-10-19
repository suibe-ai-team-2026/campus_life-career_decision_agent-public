import next from "eslint-config-next";

const config = [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "worker/**",
      "prototype/**",
      "open-notebook/**",
      "data/**",
      "public/**",
      "scripts/probe-embedding.ts",
      "scripts/probe-models.ts",
      "scripts/smoke.ts",
      "scripts/import-research.ts",
      "scripts/build-corpus.ts",
      "scripts/import/**"
    ]
  },
  {
    rules: {
      // These are deliberate hydration-safe patterns (read localStorage in an
      // effect, then hydrate state). The React Compiler rule flags them as errors.
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default config;
