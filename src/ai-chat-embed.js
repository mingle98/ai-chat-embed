const DEFAULTS = {
  vueUrl: "https://unpkg.com/vue@3/dist/vue.global.prod.js",
  lodashUrl: "https://unpkg.com/lodash@4.17.21/lodash.min.js",
  chatLibUrl: "https://unpkg.com/ai-suspended-ball-chat/dist/suspended-ball-chat.umd.js",
  mode: "ball",
  mountTo: "body",
  containerId: "ai-chat-embed-root"
};

// Each key is an instanceId; allows multiple independent panels on one page.
const instances = {};

// Shared dependency load promise (Vue + chatLib loaded once for all instances).
let depsPromise = null;

// Cache for script load promises to enable URL-based deduplication
const scriptLoadPromises = new Map();

// Cache for pending init operations to prevent concurrent initialization of same containerId
const initPendingPromises = new Map();

function safeInvoke(fn, ...args) {
  if (typeof fn !== "function") return;
  try {
    fn(...args);
  } catch {
    // Keep embed flow stable even if user callback throws.
  }
}

function assertBrowser() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("AIChatEmbed can only run in browser environments.");
  }
}

function loadScript(url, checkReady) {
  if (typeof checkReady === "function" && checkReady()) {
    return Promise.resolve();
  }

  if (scriptLoadPromises.has(url)) {
    return scriptLoadPromises.get(url);
  }

  const existing = document.querySelector(`script[data-ai-chat-embed-src="${url}"]`);
  if (existing) {
    const loadedFlag = existing.getAttribute("data-ai-chat-embed-loaded");
    const errorFlag = existing.getAttribute("data-ai-chat-embed-error");
    
    if (loadedFlag === "1") {
      const resolved = Promise.resolve();
      scriptLoadPromises.set(url, resolved);
      return resolved;
    }
    
    if (errorFlag === "1") {
      existing.remove();
    } else {
      const pendingPromise = new Promise((resolve, reject) => {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => {
          existing.setAttribute("data-ai-chat-embed-error", "1");
          reject(new Error(`Failed loading script: ${url}`));
        }, { once: true });
      });
      
      pendingPromise.catch(() => {
        scriptLoadPromises.delete(url);
      });
      
      scriptLoadPromises.set(url, pendingPromise);
      return pendingPromise;
    }
  }

  const loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.setAttribute("data-ai-chat-embed-src", url);
    script.onload = () => {
      script.setAttribute("data-ai-chat-embed-loaded", "1");
      resolve();
    };
    script.onerror = () => {
      script.setAttribute("data-ai-chat-embed-error", "1");
      reject(new Error(`Failed loading script: ${url}`));
    };
    document.head.appendChild(script);
  });

  loadPromise.catch(() => {
    scriptLoadPromises.delete(url);
  });
  
  scriptLoadPromises.set(url, loadPromise);
  return loadPromise;
}

function findChatLibrary(newKeys) {
  const candidates = [
    window.SuspendedBallChat,
    window.suspendedBallChat,
    window.AISuspendedBallChat,
    window.aiSuspendedBallChat,
    window.AiSuspendedBallChat,
    window.AI_SUSPENDED_BALL_CHAT,
    window["ai-suspended-ball-chat"]
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.SuspendedBallChat) {
      return candidate;
    }
  }

  for (const key of newKeys) {
    const maybe = window[key];
    if (maybe && typeof maybe === "object" && maybe.SuspendedBallChat) {
      return maybe;
    }
  }

  return null;
}

function applyVue2Shims() {
  if (!window.Vue) return;
  if (typeof window.Vue.component !== "function") {
    window.Vue.component = function componentShim() { return this; };
  }
  if (typeof window.Vue.extend !== "function") {
    window.Vue.extend = function extendShim(optionsArg) {
      return function Vue2CompatCtor(props) { return { ...optionsArg, props }; };
    };
  }
  if (typeof window.Vue.set !== "function") {
    window.Vue.set = function setShim(target, key, value) { target[key] = value; return value; };
  }
  if (typeof window.Vue.delete !== "function") {
    window.Vue.delete = function deleteShim(target, key) { delete target[key]; };
  }
}

async function ensureDependencies(options) {
  if (depsPromise) return depsPromise;

  depsPromise = (async () => {
    await loadScript(options.vueUrl, () => Boolean(window.Vue && window.Vue.createApp));
    await loadScript(options.lodashUrl, () => Boolean(window._ && typeof window._.cloneDeep === "function"));
    applyVue2Shims();

    const beforeKeys = new Set(Object.keys(window));
    await loadScript(options.chatLibUrl, () => Boolean(findChatLibrary([])));
    const afterKeys = Object.keys(window).filter((key) => !beforeKeys.has(key));

    const vue = window.Vue;
    if (!vue || !vue.createApp || !vue.h || !vue.reactive || !vue.ref) {
      throw new Error("Vue 3 runtime not found after loading script.");
    }

    const chatLib = findChatLibrary(afterKeys) || findChatLibrary([]);
    if (!chatLib || !chatLib.SuspendedBallChat) {
      throw new Error("Cannot find SuspendedBallChat export from ai-suspended-ball-chat.");
    }
    if (!chatLib.ChatPanel) {
      throw new Error("Cannot find ChatPanel export from ai-suspended-ball-chat.");
    }

    return { vue, chatLib };
  })().catch((error) => {
    // Allow retry on next init when first dependency loading failed.
    depsPromise = null;
    throw error;
  });

  return depsPromise;
}

function resolveMountTarget(mountTo) {
  if (!mountTo || mountTo === "body") return document.body;

  if (typeof mountTo === "string") {
    const el = document.querySelector(mountTo);
    if (!el) throw new Error(`mountTo selector not found: ${mountTo}`);
    return el;
  }

  if (mountTo instanceof HTMLElement) return mountTo;

  throw new Error("mountTo must be a CSS selector, HTMLElement, or 'body'.");
}

function ensureContainer(rootOptions) {
  const mountTarget = resolveMountTarget(rootOptions.mountTo);
  const wantedId = rootOptions.containerId;
  let container = document.getElementById(wantedId);
  let createdContainer = false;

  if (!container) {
    container = document.createElement("div");
    container.id = wantedId;
    mountTarget.appendChild(container);
    createdContainer = true;
  } else if (!container.parentNode) {
    mountTarget.appendChild(container);
  }

  return { container, createdContainer };
}

function stripEmbedKeys(options) {
  const cleaned = { ...options };
  delete cleaned.vueUrl;
  delete cleaned.lodashUrl;
  delete cleaned.chatLibUrl;
  delete cleaned.mode;
  delete cleaned.mountTo;
  delete cleaned.containerId;
  delete cleaned.onEmbedLoading;
  delete cleaned.onEmbedReady;
  delete cleaned.onEmbedError;
  return cleaned;
}

/**
 * Init an AI chat embed instance.
 *
 * @param {object} userOptions
 * @param {string} [userOptions.mode="ball"]  "ball" = floating ball, "panel" = inline panel
 * @param {string} [userOptions.containerId]  defaults to "ai-chat-embed-root" for ball,
 *                                            "ai-chat-panel-root" for panel
 * @returns {Promise<{ update, destroy }>}
 */
async function init(userOptions = {}) {
  assertBrowser();

  const mode = userOptions.mode || DEFAULTS.mode;
  if (mode !== "ball" && mode !== "panel") {
    throw new Error(`Invalid mode "${mode}". Use "ball" or "panel".`);
  }

  const defaultContainerId =
    mode === "panel" ? "ai-chat-panel-root" : DEFAULTS.containerId;

  const rootOptions = {
    ...DEFAULTS,
    containerId: defaultContainerId,
    ...userOptions,
    mode
  };

  const instanceId = rootOptions.containerId;
  const loadingMeta = { mode, containerId: rootOptions.containerId };

  if (instances[instanceId]) {
    safeInvoke(userOptions.onEmbedReady, loadingMeta);
    return instances[instanceId].publicApi;
  }

  if (initPendingPromises.has(instanceId)) {
    return initPendingPromises.get(instanceId);
  }

  const initPromise = (async () => {
    const startedAt = Date.now();
    safeInvoke(userOptions.onEmbedLoading, true, loadingMeta);
    try {
      const { vue, chatLib } = await ensureDependencies(rootOptions);
      const { container, createdContainer } = ensureContainer(rootOptions);

      const componentProps = vue.reactive(stripEmbedKeys(userOptions));
      const componentRef = vue.ref(null);

      const component = mode === "panel" ? chatLib.ChatPanel : chatLib.SuspendedBallChat;

      const app = vue.createApp({
        name: "AIChatEmbedRoot",
        render() {
          return vue.h(component, { ...componentProps, ref: componentRef });
        }
      });

      if (typeof chatLib.install === "function") {
        app.use(chatLib);
      }

      app.mount(container);

      function callComponentMethod(methodName, ...args) {
        const target = componentRef.value;
        if (!target || typeof target[methodName] !== "function") {
          throw new Error(`Method "${methodName}" is unavailable before component ready.`);
        }
        return target[methodName](...args);
      }

      const publicApi = {
        update(nextOptions = {}) {
          if (!instances[instanceId]) throw new Error("Instance already destroyed.");
          Object.assign(componentProps, stripEmbedKeys(nextOptions));
        },
        destroy() {
          if (!instances[instanceId]) return;
          app.unmount();
          if (createdContainer && container.parentNode) {
            container.parentNode.removeChild(container);
          }
          delete instances[instanceId];
          if (Object.keys(instances).length === 0) {
            depsPromise = null;
          }
        },
        invoke(methodName, ...args) {
          return callComponentMethod(methodName, ...args);
        }
      };

      const publicApiProxy = new Proxy(publicApi, {
        get(target, prop, receiver) {
          if (Reflect.has(target, prop)) {
            return Reflect.get(target, prop, receiver);
          }
          if (typeof prop === "string" && !["then", "catch", "finally"].includes(prop)) {
            return (...args) => target.invoke(prop, ...args);
          }
          return undefined;
        }
      });

      instances[instanceId] = {
        app,
        componentProps,
        componentRef,
        container,
        createdContainer,
        publicApi: publicApiProxy
      };

      safeInvoke(userOptions.onEmbedReady, {
        ...loadingMeta,
        elapsedMs: Date.now() - startedAt
      });
      return publicApiProxy;
    } catch (error) {
      safeInvoke(userOptions.onEmbedError, error, loadingMeta);
      throw error;
    } finally {
      safeInvoke(userOptions.onEmbedLoading, false, loadingMeta);
      initPendingPromises.delete(instanceId);
    }
  })();

  initPendingPromises.set(instanceId, initPromise);
  return initPromise;
}

const AIChatEmbedCore = {
  init
};
const AIChatEmbed = AIChatEmbedCore;

if (typeof window !== "undefined") {
  window.AIChatEmbed = AIChatEmbed;
}

export default AIChatEmbed;
export { init };
