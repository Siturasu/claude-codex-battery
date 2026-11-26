// Local stand-in for GitHub used by test/self-update.sh. Serves files from ROOT:
//   /latest.json              → releases/latest API
//   /download/<tag>/<file>    → release assets
//   /raw/<path>               → raw.githubusercontent.com/<repo>/main/<path>
// Prints the bound port on stdout, then serves until killed.
const root = process.argv[2];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    if (p.includes("..")) return new Response("bad", { status: 400 });
    const f = Bun.file(`${root}${p}`);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
console.log(server.port);
