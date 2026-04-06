import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["server.mjs"], {
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:web"], {
    stdio: "inherit",
    env: process.env,
  }),
];

const stopAll = () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

for (const child of children) {
  child.on("exit", () => {
    stopAll();
  });
}
