import esbuild from "esbuild";

const production = globalThis.process.argv[2] === "production";

const context = await esbuild.context({
  banner: {
    js: "/* Dynamic Template Children Updater v0.4.1 | MIT | obsidiest */",
  },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "main.js",
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2022",
  treeShaking: true,
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
