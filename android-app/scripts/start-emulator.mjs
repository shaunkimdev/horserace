import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sdk = process.argv[2] || process.env.ANDROID_HOME;
if (!sdk) throw new Error("Pass the Android SDK directory as the first argument.");
mkdirSync(path.join(root, "outputs"), { recursive: true });
const output = openSync(path.join(root, "outputs/emulator.log"), "a");
const error = openSync(path.join(root, "outputs/emulator-error.log"), "a");
const env = { ...process.env, ANDROID_USER_HOME: path.join(root, ".android"), ANDROID_AVD_HOME: path.join(root, ".android/avd") };
const child = spawn(path.join(sdk, "emulator/emulator.exe"), [
  "-avd", "DrawDerby_Test", "-no-window", "-no-audio", "-no-snapshot",
  "-no-boot-anim", "-gpu", "swiftshader", "-memory", "1536", "-partition-size", "768",
  "-no-metrics", "-port", "5556",
], { env, cwd: root, detached: true, windowsHide: true, stdio: ["ignore", output, error] });
child.on("error", (failure) => { throw failure; });
child.unref();
closeSync(output);
closeSync(error);
console.log("DrawDerby_Test emulator PID:", child.pid);
