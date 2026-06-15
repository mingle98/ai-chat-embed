import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createVueRuntime() {
  const componentApi = {
    sendMessage: vi.fn(),
    clearHistory: vi.fn(),
    stopRequest: vi.fn(),
    getChatState: vi.fn(() => ({ isStreaming: false })),
    getUiHistory: vi.fn(() => []),
    reloadUiHistory: vi.fn(async () => []),
    setUiHistory: vi.fn(),
    isStreaming: vi.fn(() => false),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    futureMethod: vi.fn((value) => `future:${value}`)
  };

  return {
    createApp(options) {
      const app = {
        used: [],
        mounted: false,
        use(plugin) {
          this.used.push(plugin);
          return this;
        },
        mount(el) {
          this.mounted = true;
          this.el = el;
          this.vnode = options.render();
          el.__vnode = this.vnode;
        },
        unmount() {
          this.mounted = false;
        }
      };
      return app;
    },
    h(component, props) {
      if (props && props.ref && typeof props.ref === "object") {
        props.ref.value = componentApi;
      }
      return { component, props };
    },
    reactive(obj) {
      return obj;
    },
    ref(initialValue) {
      return { value: initialValue };
    }
  };
}

function createChatLib({ includeBall = true, includePanel = true, withInstall = true } = {}) {
  const lib = {};
  if (includeBall) lib.SuspendedBallChat = function SuspendedBallChat() {};
  if (includePanel) lib.ChatPanel = function ChatPanel() {};
  if (withInstall) lib.install = vi.fn();
  return lib;
}

function mockScriptLoading({
  vueOk = true,
  lodashOk = true,
  chatOk = true,
  chatLib = createChatLib(),
  chatGlobalKey = "SuspendedBallChat"
} = {}) {
  const vueRuntime = createVueRuntime();
  const appendSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node.tagName === "SCRIPT") {
      setTimeout(() => {
        if (String(node.src).includes("vue")) {
          if (vueOk) {
            window.Vue = vueRuntime;
            node.onload?.();
          } else {
            node.onerror?.();
          }
          return;
        }
        if (String(node.src).includes("lodash")) {
          if (lodashOk) {
            window._ = {
              cloneDeep: (v) => JSON.parse(JSON.stringify(v))
            };
            node.onload?.();
          } else {
            node.onerror?.();
          }
          return;
        }
        if (String(node.src).includes("suspended-ball-chat")) {
          if (chatOk) {
            window[chatGlobalKey] = chatLib;
            node.onload?.();
          } else {
            node.onerror?.();
          }
          return;
        }
        node.onload?.();
      }, 0);
    }
    return node;
  });

  return { appendSpy, vueRuntime, chatLib };
}

async function loadModule() {
  vi.resetModules();
  return import("../src/ai-chat-embed.js");
}

describe("ai-chat-embed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("script[data-ai-chat-embed-src]").forEach((el) => el.remove());
    delete window.Vue;
    delete window.SuspendedBallChat;
    delete window.AISuspendedBallChat;
    delete window.aiSuspendedBallChat;
    delete window.AiSuspendedBallChat;
    delete window.AI_SUSPENDED_BALL_CHAT;
    delete window["ai-suspended-ball-chat"];
    delete window._;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts floating ball mode by default", async () => {
    const { chatLib } = mockScriptLoading();
    const mod = await loadModule();

    const api = await mod.init({
      url: "https://api.example.com/chat",
      appName: "demo",
      domainName: "u1"
    });

    const container = document.getElementById("ai-chat-embed-root");
    expect(container).toBeTruthy();
    expect(container.__vnode.component).toBe(chatLib.SuspendedBallChat);
    expect(window.AIChatEmbed).toBeTruthy();

    api.destroy();
  });

  it("mounts panel mode with default panel container id", async () => {
    const { chatLib } = mockScriptLoading();
    const mod = await loadModule();

    const api = await mod.init({
      mode: "panel",
      url: "https://api.example.com/chat",
      appName: "demo",
      domainName: "u1"
    });

    const container = document.getElementById("ai-chat-panel-root");
    expect(container).toBeTruthy();
    expect(container.__vnode.component).toBe(chatLib.ChatPanel);
    api.destroy();
  });

  it("returns same instance for repeated init with same containerId", async () => {
    mockScriptLoading();
    const mod = await loadModule();

    const a = await mod.init({ containerId: "same-id" });
    const b = await mod.init({ containerId: "same-id" });
    expect(a).toBe(b);
    a.destroy();
  });

  it("reuses depsPromise for subsequent init of another instance", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const first = await mod.init({ containerId: "first-id" });
    const second = await mod.init({ mode: "panel", containerId: "second-id" });
    expect(document.getElementById("first-id")).toBeTruthy();
    expect(document.getElementById("second-id")).toBeTruthy();
    first.destroy();
    second.destroy();
  });

  it("throws on invalid mode", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    await expect(mod.init({ mode: "invalid" })).rejects.toThrow('Invalid mode "invalid"');
  });

  it("throws when mountTo selector not found", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    await expect(mod.init({ mode: "panel", mountTo: "#not-found" })).rejects.toThrow(
      "mountTo selector not found"
    );
  });

  it("supports mountTo as HTMLElement", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const host = document.createElement("div");
    host.id = "host-el";
    document.body.appendChild(host);

    const api = await mod.init({
      mode: "panel",
      mountTo: host,
      containerId: "panel-in-host"
    });

    expect(host.querySelector("#panel-in-host")).toBeTruthy();
    api.destroy();
  });

  it("supports mountTo as existing selector string", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const host = document.createElement("div");
    host.id = "selector-host";
    document.body.appendChild(host);

    const api = await mod.init({
      mode: "panel",
      mountTo: "#selector-host",
      containerId: "panel-in-selector"
    });

    expect(host.querySelector("#panel-in-selector")).toBeTruthy();
    api.destroy();
  });

  it("throws on invalid mountTo type", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    await expect(mod.init({ mountTo: 12345 })).rejects.toThrow(
      "mountTo must be a CSS selector, HTMLElement, or 'body'"
    );
  });

  it("exposes init only on global API", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    expect(typeof mod.init).toBe("function");
    expect("update" in mod).toBe(false);
    expect("destroy" in mod).toBe(false);
  });

  it("supports imperative API methods on instance", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const api = await mod.init({ containerId: "imperative-id" });

    api.sendMessage("hello");
    expect(api.getChatState()).toEqual({ isStreaming: false });
    api.stopRequest();
    api.clearHistory();
    api.openPanel();
    api.closePanel();

    api.destroy();
  });

  it("supports dynamic method proxy for future component methods", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const api = await mod.init({ containerId: "future-id" });
    expect(api.futureMethod("x")).toBe("future:x");
    api.destroy();
  });

  it("keeps pre-existing container when destroying", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const existing = document.createElement("div");
    existing.id = "pre-existing";
    document.body.appendChild(existing);

    const api = await mod.init({ containerId: "pre-existing" });
    api.destroy();
    expect(document.getElementById("pre-existing")).toBeTruthy();
  });

  it("throws update after instance destroyed and ignores repeated destroy", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const api = await mod.init({ containerId: "lifecycle-id" });
    api.destroy();
    expect(() => api.destroy()).not.toThrow();
    expect(() => api.update({ title: "x" })).toThrow("Instance already destroyed.");
  });

  it("supports update/destroy via instance lifecycle", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const api = await mod.init({ containerId: "instance-lifecycle" });
    expect(() => api.update({ title: "B" })).not.toThrow();
    api.destroy();
    expect(document.getElementById("instance-lifecycle")).toBeNull();
  });

  it("covers ensureContainer branch when getElementById returns detached element", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const detached = document.createElement("div");
    detached.id = "detached-id";
    const originalGetById = document.getElementById.bind(document);
    vi.spyOn(document, "getElementById").mockImplementation((id) => {
      if (id === "detached-id") return detached;
      return originalGetById(id);
    });

    const api = await mod.init({ containerId: "detached-id" });
    expect(document.body.contains(detached)).toBe(true);
    api.destroy();
  });

  it("throws when vue script fails to load", async () => {
    mockScriptLoading({ vueOk: false });
    const mod = await loadModule();
    await expect(mod.init({})).rejects.toThrow("Failed loading script");
  });

  it("throws when lodash script fails to load", async () => {
    mockScriptLoading({ lodashOk: false });
    const mod = await loadModule();
    await expect(mod.init({})).rejects.toThrow("Failed loading script");
  });

  it("fires embed lifecycle callbacks", async () => {
    mockScriptLoading();
    const mod = await loadModule();
    const onLoading = vi.fn();
    const onReady = vi.fn();
    const onError = vi.fn();

    const api = await mod.init({
      containerId: "lifecycle-callback-id",
      onEmbedLoading: onLoading,
      onEmbedReady: onReady,
      onEmbedError: onError
    });

    expect(onLoading).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({ containerId: "lifecycle-callback-id" })
    );
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: "lifecycle-callback-id", elapsedMs: expect.any(Number) })
    );
    expect(onError).not.toHaveBeenCalled();
    expect(onLoading).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ containerId: "lifecycle-callback-id" })
    );

    api.destroy();
  });

  it("fires onEmbedError and allows retry after dependency failure", async () => {
    mockScriptLoading({ vueOk: false });
    const mod = await loadModule();
    const onError = vi.fn();
    await expect(mod.init({ onEmbedError: onError })).rejects.toThrow("Failed loading script");
    expect(onError).toHaveBeenCalled();

    // Retry should work because depsPromise is reset on failure.
    mockScriptLoading();
    const api = await mod.init({ containerId: "retry-after-fail" });
    expect(document.getElementById("retry-after-fail")).toBeTruthy();
    api.destroy();
  });

  it("rejects when existing pending script dispatches error event", async () => {
    const vueScript = document.createElement("script");
    vueScript.setAttribute("data-ai-chat-embed-src", "https://cdn.example.com/vue.js");
    document.head.appendChild(vueScript);

    const mod = await loadModule();
    setTimeout(() => {
      vueScript.dispatchEvent(new Event("error"));
    }, 0);

    await expect(
      mod.init({
        vueUrl: "https://cdn.example.com/vue.js",
        chatLibUrl: "https://cdn.example.com/chat.js"
      })
    ).rejects.toThrow("Failed loading script: https://cdn.example.com/vue.js");
  });

  it("throws when chat lib misses SuspendedBallChat export", async () => {
    mockScriptLoading({ chatLib: createChatLib({ includeBall: false, includePanel: true }) });
    const mod = await loadModule();
    await expect(mod.init({})).rejects.toThrow("Cannot find SuspendedBallChat export");
  });

  it("throws when chat lib misses ChatPanel export", async () => {
    mockScriptLoading({ chatLib: createChatLib({ includeBall: true, includePanel: false }) });
    const mod = await loadModule();
    await expect(mod.init({ mode: "panel" })).rejects.toThrow("Cannot find ChatPanel export");
  });

  it("loads from existing loaded script tag branch", async () => {
    window._ = { cloneDeep: (v) => v };

    const vueScript = document.createElement("script");
    vueScript.setAttribute("data-ai-chat-embed-src", "https://cdn.example.com/vue.js");
    vueScript.setAttribute("data-ai-chat-embed-loaded", "1");
    document.head.appendChild(vueScript);

    const chatScript = document.createElement("script");
    chatScript.setAttribute("data-ai-chat-embed-src", "https://cdn.example.com/chat.js");
    chatScript.setAttribute("data-ai-chat-embed-loaded", "1");
    document.head.appendChild(chatScript);

    // Existing loaded scripts resolve immediately; runtime still absent -> should fail at vue check.
    const mod = await loadModule();
    await expect(
      mod.init({
        vueUrl: "https://cdn.example.com/vue.js",
        chatLibUrl: "https://cdn.example.com/chat.js"
      })
    ).rejects.toThrow("Vue 3 runtime not found");
  });

  it("loads from pre-existing pending script via load event branch", async () => {
    window._ = { cloneDeep: (v) => v };

    const vueScript = document.createElement("script");
    vueScript.setAttribute("data-ai-chat-embed-src", "https://cdn.example.com/vue.js");
    document.head.appendChild(vueScript);

    const chatLib = createChatLib();
    const chatScriptLoader = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation((node) => {
        if (node.tagName === "SCRIPT" && String(node.src).includes("chat.js")) {
          setTimeout(() => {
            window.SuspendedBallChat = chatLib;
            node.onload?.();
          }, 0);
        }
        return node;
      });

    const mod = await loadModule();

    setTimeout(() => {
      window.Vue = createVueRuntime();
      vueScript.dispatchEvent(new Event("load"));
    }, 0);

    const api = await mod.init({
      vueUrl: "https://cdn.example.com/vue.js",
      chatLibUrl: "https://cdn.example.com/chat.js"
    });

    expect(chatScriptLoader).toHaveBeenCalled();
    api.destroy();
  });

  it("resolves chat library from newly added unknown global key", async () => {
    const customKey = "CustomChatExportKey";
    const chatLib = createChatLib();
    mockScriptLoading({ chatGlobalKey: customKey, chatLib });
    const mod = await loadModule();

    const api = await mod.init({ mode: "panel", containerId: "unknown-key-case" });
    const container = document.getElementById("unknown-key-case");
    expect(container.__vnode.component).toBe(chatLib.ChatPanel);
    api.destroy();
  });

  it("uses checkReady fast-path when Vue and chat lib already exist", async () => {
    const mod = await loadModule();
    window.Vue = createVueRuntime();
    window._ = { cloneDeep: (v) => v };
    window.SuspendedBallChat = createChatLib();
    const appendSpy = vi.spyOn(document.head, "appendChild");

    const api = await mod.init({
      mode: "panel",
      containerId: "ready-fast-path"
    });

    expect(appendSpy).not.toHaveBeenCalled();
    api.destroy();
  });

  it("executes injected Vue2 shim methods", async () => {
    const vueRuntime = createVueRuntime();
    // Force shim injection for all methods.
    delete vueRuntime.component;
    delete vueRuntime.extend;
    delete vueRuntime.set;
    delete vueRuntime.delete;

    const chatLib = createChatLib();
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      if (node.tagName === "SCRIPT") {
        setTimeout(() => {
          if (String(node.src).includes("vue")) {
            window.Vue = vueRuntime;
            node.onload?.();
          } else if (String(node.src).includes("lodash")) {
            window._ = { cloneDeep: (v) => v };
            node.onload?.();
          } else if (String(node.src).includes("suspended-ball-chat")) {
            window.SuspendedBallChat = chatLib;
            node.onload?.();
          }
        }, 0);
      }
      return node;
    });

    const mod = await loadModule();
    const api = await mod.init({});

    const obj = {};
    expect(window.Vue.component("X", {})).toBe(window.Vue);
    expect(typeof window.Vue.extend({ a: 1 })).toBe("function");
    expect(window.Vue.set(obj, "k", 123)).toBe(123);
    window.Vue.delete(obj, "k");
    expect("k" in obj).toBe(false);

    api.destroy();
  });

  it("throws in non-browser runtime", async () => {
    mockScriptLoading();
    const mod = await loadModule();

    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;

    try {
      // @ts-ignore - intentional runtime simulation
      globalThis.window = undefined;
      // @ts-ignore - intentional runtime simulation
      globalThis.document = undefined;
      await expect(mod.init({})).rejects.toThrow("browser environments");
    } finally {
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  });
});
