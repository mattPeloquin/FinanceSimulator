import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.browser
            }
        }
    },
    {
        files: ["tests/**/*.js", "playwright.config.js", "vitest.config.js", "vite.config.js"],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                describe: "readonly",
                it: "readonly",
                test: "readonly",
                expect: "readonly",
                beforeEach: "readonly",
                afterEach: "readonly",
                beforeAll: "readonly",
                afterAll: "readonly",
            }
        }
    },
    {
        files: ["*.js", "scripts/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },
    {
        ignores: [
            "dist/", 
            "playwright-report/", 
            "test-results/", 
            "node_modules/",
            "scratch/"
        ]
    }
];