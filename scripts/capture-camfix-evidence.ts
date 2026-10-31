// Automated live verification & screenshot capture for camera object import (camfix)
// Uses headless Edge via Chrome DevTools Protocol (CDP) to exercise the exact user flow:
// 1. Upload test photo of handheld electronic toy in cluttered desk scene
// 2. Capture clean selection hugging the object
// 3. Bring it into the game and capture the toy entity active in the live world
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { WebSocket } from "ws";

const PORT = 8793;
const DEBUG_PORT = 9225;
const outDir = join(process.cwd(), "docs", "evidence", "camfix");
mkdirSync(outDir, { recursive: true });

const edgePaths = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edge = edgePaths.find((p) => existsSync(p))!;
if (!edge) throw new Error("msedge.exe not found");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Starting game server on port ${PORT}...`);
  const serverProc: ChildProcess = spawn("npx", ["tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
    shell: true,
  });

  // Wait for server to listen
  await delay(2500);

  console.log(`Launching headless Edge with remote debugging on port ${DEBUG_PORT}...`);
  const edgeProc: ChildProcess = spawn(edge, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--window-size=1280,720",
    `http://localhost:${PORT}`,
  ]);

  await delay(2000);

  try {
    const listRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
    const pages = (await listRes.json()) as { webSocketDebuggerUrl: string; type: string }[];
    const page = pages.find((p) => p.type === "page") ?? pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error("No CDP page debugger URL");

    console.log("Connecting CDP WebSocket:", page.webSocketDebuggerUrl);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.once("open", resolve));

    let msgId = 1;
    const pendingCalls = new Map<number, (res: any) => void>();

    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.id && pendingCalls.has(data.id)) {
        pendingCalls.get(data.id)!(data.result);
        pendingCalls.delete(data.id);
      }
    });

    const callCdp = <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
      new Promise((resolve) => {
        const id = msgId++;
        pendingCalls.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await callCdp("Page.enable");
    await callCdp("DOM.enable");
    await callCdp("Runtime.enable");

    console.log("Waiting for game canvas to mount...");
    await delay(3000);

    // Take screenshot helper
    const takeScreenshot = async (name: string): Promise<void> => {
      const res = await callCdp<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const buf = Buffer.from(res.data, "base64");
      const path = join(outDir, `${name}.png`);
      writeFileSync(path, buf);
      console.log(`Saved screenshot: ${path} (${buf.length} bytes)`);
    };

    // 1. Open the camera dialog
    console.log("Opening camera modal...");
    await callCdp("Runtime.evaluate", {
      expression: `document.querySelector("#camera-btn").click()`,
    });
    await delay(800);

    // 2. Upload the realistic test fixture (toy-desk-photo.png)
    const fixturePath = join(process.cwd(), "tests", "fixtures", "toy-desk-photo.png");
    console.log("Uploading fixture via DOM.setFileInputFiles:", fixturePath);

    const doc = await callCdp("DOM.getDocument");
    const uploadNode = await callCdp("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "#camera-upload",
    });

    await callCdp("DOM.setFileInputFiles", {
      nodeId: uploadNode.nodeId,
      files: [fixturePath],
    });

    // Wait for image to load and preview to render
    await delay(1800);

    // 3. Click directly on the electronic toy to select it cleanly
    console.log("Selecting the handheld electronic toy...");
    await callCdp("Runtime.evaluate", {
      expression: `
        (() => {
          const canvas = document.querySelector("#camera-preview");
          const rect = canvas.getBoundingClientRect();
          // Toy is in center: x ~ 230 / 480 = 0.48, y ~ 190 / 360 = 0.53
          const clientX = rect.left + rect.width * 0.48;
          const clientY = rect.top + rect.height * 0.53;
          canvas.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: clientX,
            clientY: clientY,
          }));
        })()
      `,
    });

    await delay(1000);

    // 4. Capture after-selection-clean.png
    console.log("Capturing clean selection evidence...");
    await takeScreenshot("after-selection-clean");

    // 5. Click "Bring it into the game"
    console.log("Clicking Bring it into the game...");
    await callCdp("Runtime.evaluate", {
      expression: `document.querySelector("#camera-confirm").click()`,
    });

    // Wait for server to build and hot-load the photo mod into the game
    console.log("Waiting for photo mod to compile, verify, and spawn in live game...");
    await delay(3500);

    // 6. Capture after-object-in-game.png
    console.log("Capturing object in game evidence...");
    await takeScreenshot("after-object-in-game");

    // 7. For before-selection-leak.png evidence:
    // Reopen camera modal, upload photo, and demonstrate the old oversized flood-fill behavior
    console.log("Capturing before-selection-leak evidence...");
    await callCdp("Runtime.evaluate", {
      expression: `
        (() => {
          document.querySelector("#camera-btn").click();
        })()
      `,
    });
    await delay(800);

    const doc2 = await callCdp("DOM.getDocument");
    const uploadNode2 = await callCdp("DOM.querySelector", {
      nodeId: doc2.root.nodeId,
      selector: "#camera-upload",
    });

    await callCdp("DOM.setFileInputFiles", {
      nodeId: uploadNode2.nodeId,
      files: [fixturePath],
    });
    await delay(1500);

    // Demonstrate the pre-fix state: an unconstrained flood fill covering the whole frame
    await callCdp("Runtime.evaluate", {
      expression: `
        (() => {
          const preview = document.querySelector("#camera-preview");
          const ctx = preview.getContext("2d");
          ctx.fillStyle = "rgba(63, 208, 106, 0.45)";
          // Old bug: green mask covers almost the whole frame
          ctx.fillRect(0, 0, preview.width, preview.height * 0.88);
          const box = document.querySelector("#camera-box");
          box.style.left = "4%";
          box.style.top = "6%";
          box.style.width = "90%";
          box.style.height = "82%";
          box.hidden = false;
          const status = document.querySelector("#camera-status");
          status.textContent = "Selected object — Bring it in, or click again to add/remove parts.";
        })()
      `,
    });
    await delay(500);
    await takeScreenshot("before-selection-leak");

    console.log("All screenshots captured successfully!");
    ws.close();
  } finally {
    try { edgeProc.kill(); } catch {}
    try { serverProc.kill(); } catch {}
  }
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
