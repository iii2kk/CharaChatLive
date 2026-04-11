"use client";

interface AmmoModule {
  btVector3: new (x: number, y: number, z: number) => unknown;
}

interface AmmoFactory {
  (config?: {
    locateFile?: (path: string, prefix?: string) => string;
  }): Promise<AmmoModule>;
}

declare global {
  interface Window {
    Ammo?: AmmoFactory | AmmoModule;
  }
}

let ammoPromise: Promise<AmmoModule> | null = null;

function isAmmoModule(value: unknown): value is AmmoModule {
  return typeof value === "object" && value !== null && "btVector3" in value;
}

function loadAmmoScript() {
  return new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-ammo-loader="true"]'
    );

    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Ammo.js script failed to load")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "/api/ammo-js";
    script.async = true;
    script.dataset.ammoLoader = "true";
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error("Ammo.js script failed to load")),
      { once: true }
    );

    document.head.appendChild(script);
  });
}

export async function ensureAmmo() {
  if (typeof window === "undefined") {
    throw new Error("Ammo.js can only be loaded in the browser");
  }

  if (isAmmoModule(window.Ammo)) {
    return window.Ammo;
  }

  if (ammoPromise) {
    return ammoPromise;
  }

  ammoPromise = (async () => {
    await loadAmmoScript();

    if (isAmmoModule(window.Ammo)) {
      return window.Ammo;
    }

    if (typeof window.Ammo !== "function") {
      throw new Error("Ammo.js factory was not found on window");
    }

    const ammo = await window.Ammo({
      locateFile: (path) =>
        path.endsWith(".wasm") ? "/api/ammo-wasm" : path,
    });

    window.Ammo = ammo;
    return ammo;
  })().catch((error) => {
    ammoPromise = null;
    throw error;
  });

  return ammoPromise;
}
