import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

export default [
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            "coverage/**",
            "storage/**",
            // Own linter and oxlint setup.
            "src/web/**",
            // Python package: no JavaScript in it, and .venv is a symlink that
            // would otherwise be walked in full on every lint.
            "services/**",
        ],
    },
    ...tsPlugin.configs["flat/recommended"],
    prettierConfig,
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
];
