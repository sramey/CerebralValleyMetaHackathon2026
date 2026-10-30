// Hermetic generated-art cache for tests (bead cvu). `server/art.ts` reads and writes sheets
// under `public/art/gen/` unless `ART_GEN_DIR` points somewhere else. A live session leaves real
// .webp files there, and a test that asks for the same subject then skips generation and fails
// (tests/ontology.test.ts "classifies held items" did exactly that with a cached gun.webp).
// Every test file gets its own throwaway folder instead, so no test can see — or dirty — the
// checkout's art cache. Production is untouched: without the env var the default still applies.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "metabuild-art-gen-"));
process.env.ART_GEN_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
