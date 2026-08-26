import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

class Element {
  constructor(text = "") {
    this.attributes = new Map();
    this.className = "";
    this.listeners = new Map();
    this.style = {};
    this.textContent = text;
    this.value = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, detail) {
    const event = Object.assign({ preventDefault() {} }, detail);
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  /* Overridden per-instance in createHarness so focus() can update that
     harness's own activeElementId tracking; a no-op here covers elements
     created outside that wiring (e.g. quick-date buttons). */
  focus() {}

  select() {}
}

function createHarness(
  initialHref = "https://example.test/?lang=zh&date=2026-08-20#usage",
  options = {}
) {
  const ids = [
    "query-form", "date-input", "prev-day", "next-day", "today-btn",
    "result", "error-message", "empty-message", "result-date", "result-badge",
    "result-name", "result-category", "result-description", "result-raw",
    "copy-source", "theme-toggle",
    "install-tabs-list",
    "install-tab-posix", "install-tab-powershell",
    "install-panel-posix", "install-panel-powershell",
    "install-posix", "install-powershell", "agent-skill-install"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements["copy-source"].textContent = "copy me";
  elements["install-posix"].textContent =
    "curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh";
  elements["install-powershell"].textContent =
    "irm https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.ps1 | iex";
  elements["agent-skill-install"].textContent =
    "npx skills add https://github.com/doggy8088/holidaybook/tree/master/skill";

  /* Mirrors the no-JavaScript fallback: tab controls start hidden and without
     ARIA tab semantics, while both install panels remain visible. app.js owns
     the complete enhancement into a single-panel tab interface. */
  elements["install-tabs-list"].setAttribute("hidden", "");

  let activeElementId = null;
  for (const id of ids) {
    elements[id].focus = function () {
      activeElementId = id;
    };
  }

  const quickButtons = [0, 1, 7].map((offset) => {
    const button = new Element();
    button.setAttribute("data-offset", offset);
    return button;
  });
  const copyButton = new Element("複製");
  copyButton.setAttribute("data-copy-target", "copy-source");
  const installPosixCopyButton = new Element("複製");
  installPosixCopyButton.setAttribute("data-copy-target", "install-posix");
  const installPowershellCopyButton = new Element("複製");
  installPowershellCopyButton.setAttribute("data-copy-target", "install-powershell");
  const agentSkillCopyButton = new Element("複製");
  agentSkillCopyButton.setAttribute("data-copy-target", "agent-skill-install");
  const copyButtons = [
    copyButton,
    installPosixCopyButton,
    installPowershellCopyButton,
    agentSkillCopyButton
  ];

  const document = {
    body: {
      appendChild() {},
      removeChild() {}
    },
    documentElement: {
      dataset: {}
    },
    createElement() {
      return new Element();
    },
    execCommand() {
      return true;
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === ".quick-dates [data-offset]") return quickButtons;
      if (selector === "[data-copy-target]") return copyButtons;
      return [];
    }
  };

  const entries = [initialHref];
  let entryIndex = 0;
  let pushCalls = 0;
  let replaceCalls = 0;
  const windowListeners = new Map();
  const location = {};
  Object.defineProperties(location, {
    href: { get: () => entries[entryIndex] },
    search: { get: () => new URL(entries[entryIndex]).search },
    hash: { get: () => new URL(entries[entryIndex]).hash }
  });

  function setEntry(url, replace) {
    const href = new URL(url, entries[entryIndex]).toString();
    if (replace) {
      entries[entryIndex] = href;
    } else {
      entries.splice(entryIndex + 1);
      entries.push(href);
      entryIndex++;
    }
  }

  function dispatchWindow(type) {
    for (const listener of windowListeners.get(type) || []) listener({ state: null });
  }

  const history = {
    get length() {
      return entries.length;
    },
    pushState(_state, _title, url) {
      pushCalls++;
      setEntry(url, false);
    },
    replaceState(_state, _title, url) {
      replaceCalls++;
      setEntry(url, true);
    },
    back() {
      if (entryIndex === 0) return;
      entryIndex--;
      dispatchWindow("popstate");
    },
    forward() {
      if (entryIndex === entries.length - 1) return;
      entryIndex++;
      dispatchWindow("popstate");
    }
  };

  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  function setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, due: now + delay });
    return id;
  }
  function clearTimeout(id) {
    timers.delete(id);
  }
  function tick(ms) {
    now += ms;
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.due <= now)
      .sort((a, b) => a[1].due - b[1].due);
    for (const [id, timer] of due) {
      if (!timers.delete(id)) continue;
      timer.callback();
    }
  }

  const fetchCalls = [];
  const pendingFetches = [];
  const pendingBodies = [];
  function buildResponse(date) {
    const body = {
      date: date.replaceAll("-", ""),
      isHoliday: 0,
      name: `data for ${date}`,
      holidaycategory: "",
      description: ""
    };
    return {
      ok: true,
      status: 200,
      json: () => {
        if (!options.manualBody) return Promise.resolve(body);
        /* Defers the parsed body so tests can model the window between the
           headers arriving and response.json() settling, during which a newer
           query can start. */
        return new Promise((resolve) => {
          pendingBodies.push({
            resolve: (override) => resolve(override === undefined ? body : override)
          });
        });
      }
    };
  }
  function fetch(path) {
    fetchCalls.push(path);
    const date = path.replace(".json", "");
    if (!options.manualFetch) {
      return Promise.resolve(buildResponse(date));
    }
    /* Deliberately ignores the abort signal so tests can model a browser
       without AbortController, where a superseded request still settles. */
    return new Promise((resolve, reject) => {
      pendingFetches.push({
        resolve: () => resolve(buildResponse(date)),
        reject: (error) => reject(error)
      });
    });
  }

  const clipboardWrites = [];
  const navigator = {
    clipboard: {
      writeText(value) {
        clipboardWrites.push(value);
        return Promise.resolve();
      }
    }
  };
  let storedTheme = options.storedTheme ?? null;
  const storageWrites = [];
  const localStorage = {
    getItem(key) {
      if (options.storageFailure) throw new Error("storage unavailable");
      return key === "holidaybook-theme" ? storedTheme : null;
    },
    setItem(key, value) {
      if (options.storageFailure) throw new Error("storage unavailable");
      storageWrites.push([key, value]);
      if (key === "holidaybook-theme") storedTheme = value;
    }
  };
  const colorSchemeListeners = new Set();
  const colorSchemeQuery = {
    matches: options.systemDark === true,
    addEventListener(type, listener) {
      if (type === "change") colorSchemeListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "change") colorSchemeListeners.delete(listener);
    }
  };
  const window = {
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    clearTimeout,
    history,
    localStorage,
    location,
    matchMedia: options.matchMediaUnavailable
      ? undefined
      : () => colorSchemeQuery,
    setTimeout
  };

  vm.runInNewContext(appSource, {
    AbortController,
    Date,
    Intl,
    URL,
    URLSearchParams,
    console,
    document,
    fetch,
    navigator,
    window
  });

  return {
    copyButton,
    installPosixCopyButton,
    installPowershellCopyButton,
    agentSkillCopyButton,
    clipboardWrites,
    elements,
    fetchCalls,
    get activeElementId() {
      return activeElementId;
    },
    get colorSchemeListenerCount() {
      return colorSchemeListeners.size;
    },
    get href() {
      return location.href;
    },
    get pushCalls() {
      return pushCalls;
    },
    get replaceCalls() {
      return replaceCalls;
    },
    get theme() {
      return document.documentElement.dataset.theme;
    },
    history,
    navigateHash(hash) {
      const url = new URL(location.href);
      url.hash = hash;
      setEntry(url, false);
      dispatchWindow("popstate");
    },
    navigateTo(url) {
      setEntry(url, false);
    },
    rejectFetch(index, error) {
      pendingFetches[index].reject(error);
    },
    resolveFetch(index) {
      pendingFetches[index].resolve();
    },
    get pendingBodyCount() {
      return pendingBodies.length;
    },
    resolveBody(index, ...override) {
      pendingBodies[index].resolve(override.length > 0 ? override[0] : undefined);
    },
    get storedTheme() {
      return storedTheme;
    },
    storageWrites,
    setSystemDark(isDark) {
      colorSchemeQuery.matches = isDark;
      for (const listener of colorSchemeListeners) listener({ matches: isDark });
    },
    tick
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

test("boot replaces the current entry without adding history", async () => {
  const app = createHarness();
  await settle();

  assert.equal(app.history.length, 1);
  assert.equal(app.pushCalls, 0);
  assert.equal(app.replaceCalls, 1);
  assert.equal(app.elements["date-input"].value, "2026-08-20");
  assert.equal(app.fetchCalls[0], "2026-08-20.json");
});

test("changed dates push once while same-date submissions do not push", async () => {
  const app = createHarness();
  await settle();

  app.elements["date-input"].value = "2026-08-21";
  app.elements["query-form"].dispatch("submit");
  await settle();
  assert.equal(app.history.length, 2);
  assert.equal(app.pushCalls, 1);
  assert.match(app.href, /[?&]date=2026-08-21(?:&|#|$)/);
  assert.match(app.href, /[?&]lang=zh(?:&|#|$)/);
  assert.match(app.href, /#usage$/);

  app.elements["query-form"].dispatch("submit");
  await settle();
  assert.equal(app.history.length, 2);
  assert.equal(app.pushCalls, 1);
});

test("Back and Forward restore the date and rendered data without trapping history", async () => {
  const app = createHarness();
  await settle();

  app.elements["next-day"].dispatch("click");
  await settle();
  app.elements["next-day"].dispatch("click");
  await settle();
  assert.equal(app.history.length, 3);
  assert.equal(app.pushCalls, 2);

  app.history.back();
  assert.equal(app.elements["date-input"].value, "2026-08-21");
  assert.equal(app.elements.result.getAttribute("data-state"), "loading");
  await settle();
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-21");
  assert.equal(app.history.length, 3);
  assert.equal(app.pushCalls, 2);

  app.history.back();
  await settle();
  assert.equal(app.elements["date-input"].value, "2026-08-20");
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-20");

  app.history.forward();
  await settle();
  assert.equal(app.elements["date-input"].value, "2026-08-21");
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-21");
  assert.equal(app.history.length, 3);
  assert.equal(app.pushCalls, 2);
});

test("invalid dates render an error without mutating URL or history", async () => {
  const app = createHarness();
  await settle();
  const href = app.href;
  const fetchCount = app.fetchCalls.length;

  app.elements["date-input"].value = "2026-02-30";
  app.elements["query-form"].dispatch("submit");

  assert.equal(app.href, href);
  assert.equal(app.history.length, 1);
  assert.equal(app.pushCalls, 0);
  assert.equal(app.replaceCalls, 1);
  assert.equal(app.fetchCalls.length, fetchCount);
  assert.equal(app.elements.result.getAttribute("data-state"), "error");
});

test("hash-only popstate does not refetch an unchanged date", async () => {
  const app = createHarness();
  await settle();
  const fetchCount = app.fetchCalls.length;

  app.navigateHash("#another-section");
  await settle();

  assert.equal(app.fetchCalls.length, fetchCount);
  assert.match(app.href, /#another-section$/);
  assert.equal(app.elements["date-input"].value, "2026-08-20");
});

test("restoring an entry without a date never writes back to history", async () => {
  const app = createHarness();
  await settle();
  const pushCalls = app.pushCalls;
  const replaceCalls = app.replaceCalls;

  app.navigateTo("https://example.test/");
  app.navigateTo("https://example.test/?date=2026-08-25");
  app.history.back();
  await settle();

  assert.equal(app.elements["date-input"].value, taipeiToday());
  assert.equal(app.href, "https://example.test/");
  assert.equal(app.pushCalls, pushCalls);
  assert.equal(app.replaceCalls, replaceCalls);
});

test("a superseded response never overwrites the newest result", async () => {
  const app = createHarness(undefined, { manualFetch: true });
  await settle();

  app.elements["date-input"].value = "2026-08-22";
  app.elements["query-form"].dispatch("submit");
  await settle();
  assert.deepEqual(app.fetchCalls, ["2026-08-20.json", "2026-08-22.json"]);

  app.resolveFetch(1);
  await settle();
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-22");

  app.resolveFetch(0);
  await settle();
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-22");
  assert.equal(app.elements.result.getAttribute("data-state"), "success");
});

test("a superseded failure never replaces the newest result with an error", async () => {
  const app = createHarness(undefined, { manualFetch: true });
  await settle();

  app.elements["date-input"].value = "2026-08-22";
  app.elements["query-form"].dispatch("submit");
  await settle();

  app.resolveFetch(1);
  await settle();
  assert.equal(app.elements.result.getAttribute("data-state"), "success");

  app.rejectFetch(0, new Error("network down"));
  await settle();
  assert.equal(app.elements.result.getAttribute("data-state"), "success");
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-22");
});

test("a superseded response body never overwrites the newest result", async () => {
  const app = createHarness(undefined, { manualBody: true });
  await settle();
  assert.equal(app.pendingBodyCount, 1);

  app.elements["date-input"].value = "2026-08-22";
  app.elements["query-form"].dispatch("submit");
  await settle();
  assert.deepEqual(app.fetchCalls, ["2026-08-20.json", "2026-08-22.json"]);
  assert.equal(app.pendingBodyCount, 2);

  app.resolveBody(1);
  await settle();
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-22");

  app.resolveBody(0);
  await settle();
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-22");
  assert.equal(app.elements.result.getAttribute("data-state"), "success");
});

test("a superseded malformed body never replaces the newest result with an error", async () => {
  const app = createHarness(undefined, { manualBody: true });
  await settle();

  app.elements["date-input"].value = "2026-08-22";
  app.elements["query-form"].dispatch("submit");
  await settle();

  app.resolveBody(1);
  await settle();
  assert.equal(app.elements.result.getAttribute("data-state"), "success");

  app.resolveBody(0, []);
  await settle();
  assert.equal(app.elements.result.getAttribute("data-state"), "success");
  assert.equal(app.elements["result-name"].textContent, "data for 2026-08-22");
});

test("rapid repeated copy feedback restores the original label after the latest delay", async () => {
  const app = createHarness();
  await settle();

  app.copyButton.dispatch("click");
  await settle();
  assert.equal(app.copyButton.textContent, "已複製");

  app.tick(1000);
  app.copyButton.dispatch("click");
  await settle();
  app.tick(500);
  assert.equal(app.copyButton.textContent, "已複製");

  app.tick(999);
  assert.equal(app.copyButton.textContent, "已複製");
  app.tick(1);
  assert.equal(app.copyButton.textContent, "複製");
});

test("first visit follows the effective system theme and its changes", () => {
  const app = createHarness(undefined, { systemDark: true });
  const toggle = app.elements["theme-toggle"];

  assert.equal(app.theme, "dark");
  assert.equal(app.elements["theme-toggle"].textContent, "切換至淺色模式");
  assert.equal(toggle.getAttribute("aria-label"), "切換至淺色模式");
  assert.equal(toggle.getAttribute("title"), "切換至淺色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");

  app.setSystemDark(false);
  assert.equal(app.theme, "light");
  assert.equal(toggle.textContent, "切換至深色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});

test("saved valid theme overrides the system preference", () => {
  const app = createHarness(undefined, {
    storedTheme: "light",
    systemDark: true
  });
  const toggle = app.elements["theme-toggle"];

  assert.equal(app.theme, "light");
  assert.equal(toggle.textContent, "切換至深色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");

  app.setSystemDark(false);
  app.setSystemDark(true);
  assert.equal(app.theme, "light");
  assert.equal(toggle.textContent, "切換至深色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});

test("theme toggle applies and persists an explicit binary choice", () => {
  const app = createHarness(undefined, { systemDark: false });
  const toggle = app.elements["theme-toggle"];

  assert.equal(app.colorSchemeListenerCount, 1);

  toggle.dispatch("click");
  assert.equal(app.theme, "dark");
  assert.equal(toggle.textContent, "切換至淺色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(app.storedTheme, "dark");
  assert.deepEqual(app.storageWrites, [["holidaybook-theme", "dark"]]);
  assert.equal(app.colorSchemeListenerCount, 0);

  app.setSystemDark(false);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");

  toggle.dispatch("click");
  assert.equal(app.theme, "light");
  assert.equal(toggle.textContent, "切換至深色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(app.storedTheme, "light");
});

test("a corrupted stored theme is ignored in favour of the system preference", () => {
  const app = createHarness(undefined, {
    storedTheme: "midnight",
    systemDark: true
  });

  assert.equal(app.theme, "dark");
  assert.equal(
    app.elements["theme-toggle"].getAttribute("aria-pressed"),
    "true"
  );

  app.setSystemDark(false);
  assert.equal(app.theme, "light");
  assert.equal(
    app.elements["theme-toggle"].getAttribute("aria-pressed"),
    "false"
  );
});

test("storage failures do not prevent system theme or manual toggling", () => {
  const app = createHarness(undefined, {
    storageFailure: true,
    systemDark: true
  });
  const toggle = app.elements["theme-toggle"];

  assert.equal(app.theme, "dark");
  assert.equal(toggle.textContent, "切換至淺色模式");
  assert.doesNotThrow(() => toggle.dispatch("click"));
  assert.equal(app.theme, "light");
  assert.equal(toggle.textContent, "切換至深色模式");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});

test("missing matchMedia safely defaults to light mode", () => {
  const app = createHarness(undefined, { matchMediaUnavailable: true });

  assert.equal(app.theme, "light");
  assert.equal(
    app.elements["theme-toggle"].getAttribute("aria-pressed"),
    "false"
  );
});

/* ---- Native install tabs (macOS/Linux vs Windows PowerShell) ---- */

function installTabState(app) {
  const tabList = app.elements["install-tabs-list"];
  const posixTab = app.elements["install-tab-posix"];
  const powershellTab = app.elements["install-tab-powershell"];
  const posixPanel = app.elements["install-panel-posix"];
  const powershellPanel = app.elements["install-panel-powershell"];
  return {
    tabList,
    posixTab,
    powershellTab,
    posixPanel,
    powershellPanel,
    tabListRole: tabList.getAttribute("role"),
    tabListLabelledby: tabList.getAttribute("aria-labelledby"),
    tabListHidden: tabList.getAttribute("hidden"),
    posixRole: posixTab.getAttribute("role"),
    powershellRole: powershellTab.getAttribute("role"),
    posixControls: posixTab.getAttribute("aria-controls"),
    powershellControls: powershellTab.getAttribute("aria-controls"),
    posixSelected: posixTab.getAttribute("aria-selected"),
    powershellSelected: powershellTab.getAttribute("aria-selected"),
    posixTabindex: posixTab.getAttribute("tabindex"),
    powershellTabindex: powershellTab.getAttribute("tabindex"),
    posixPanelRole: posixPanel.getAttribute("role"),
    powershellPanelRole: powershellPanel.getAttribute("role"),
    posixPanelLabelledby: posixPanel.getAttribute("aria-labelledby"),
    powershellPanelLabelledby: powershellPanel.getAttribute("aria-labelledby"),
    posixPanelTabindex: posixPanel.getAttribute("tabindex"),
    powershellPanelTabindex: powershellPanel.getAttribute("tabindex"),
    posixHidden: posixPanel.getAttribute("hidden"),
    powershellHidden: powershellPanel.getAttribute("hidden")
  };
}

test("install tabs progressively enhance with complete ARIA semantics", () => {
  const app = createHarness();
  const state = installTabState(app);

  assert.equal(state.tabListRole, "tablist");
  assert.equal(state.tabListLabelledby, "install-heading");
  assert.equal(state.tabListHidden, null);
  assert.equal(state.posixRole, "tab");
  assert.equal(state.powershellRole, "tab");
  assert.equal(state.posixControls, "install-panel-posix");
  assert.equal(state.powershellControls, "install-panel-powershell");
  assert.equal(state.posixSelected, "true");
  assert.equal(state.powershellSelected, "false");
  assert.equal(state.posixTabindex, "0");
  assert.equal(state.powershellTabindex, "-1");
  assert.equal(state.posixPanelRole, "tabpanel");
  assert.equal(state.powershellPanelRole, "tabpanel");
  assert.equal(state.posixPanelLabelledby, "install-tab-posix");
  assert.equal(state.powershellPanelLabelledby, "install-tab-powershell");
  assert.equal(state.posixPanelTabindex, "0");
  assert.equal(state.powershellPanelTabindex, "0");
  assert.equal(state.posixHidden, null);
  assert.equal(state.powershellHidden, "");
});

test("clicking the PowerShell tab switches selection and panel visibility without moving focus", () => {
  const app = createHarness();

  app.elements["install-tab-powershell"].dispatch("click");
  const state = installTabState(app);

  assert.equal(state.posixSelected, "false");
  assert.equal(state.powershellSelected, "true");
  assert.equal(state.posixTabindex, "-1");
  assert.equal(state.powershellTabindex, "0");
  assert.equal(state.posixHidden, "");
  assert.equal(state.powershellHidden, null);
  assert.equal(app.activeElementId, null);
});

test("clicking back to the macOS/Linux tab restores it and re-hides the PowerShell panel", () => {
  const app = createHarness();

  app.elements["install-tab-powershell"].dispatch("click");
  app.elements["install-tab-posix"].dispatch("click");
  const state = installTabState(app);

  assert.equal(state.posixSelected, "true");
  assert.equal(state.powershellSelected, "false");
  assert.equal(state.posixHidden, null);
  assert.equal(state.powershellHidden, "");
});

test("ArrowRight and ArrowLeft move selection and focus between the two tabs, wrapping at both ends", () => {
  const app = createHarness();

  app.elements["install-tab-posix"].dispatch("keydown", { key: "ArrowRight" });
  let state = installTabState(app);
  assert.equal(state.powershellSelected, "true");
  assert.equal(app.activeElementId, "install-tab-powershell");

  // Wraps forward from the last tab back to the first.
  app.elements["install-tab-powershell"].dispatch("keydown", { key: "ArrowRight" });
  state = installTabState(app);
  assert.equal(state.posixSelected, "true");
  assert.equal(app.activeElementId, "install-tab-posix");

  // Wraps backward from the first tab to the last.
  app.elements["install-tab-posix"].dispatch("keydown", { key: "ArrowLeft" });
  state = installTabState(app);
  assert.equal(state.powershellSelected, "true");
  assert.equal(app.activeElementId, "install-tab-powershell");

  app.elements["install-tab-powershell"].dispatch("keydown", { key: "ArrowLeft" });
  state = installTabState(app);
  assert.equal(state.posixSelected, "true");
  assert.equal(app.activeElementId, "install-tab-posix");
});

test("Home and End jump to the first and last tab and move focus", () => {
  const app = createHarness();

  app.elements["install-tab-posix"].dispatch("keydown", { key: "End" });
  let state = installTabState(app);
  assert.equal(state.powershellSelected, "true");
  assert.equal(app.activeElementId, "install-tab-powershell");

  app.elements["install-tab-powershell"].dispatch("keydown", { key: "Home" });
  state = installTabState(app);
  assert.equal(state.posixSelected, "true");
  assert.equal(app.activeElementId, "install-tab-posix");
});

test("unrelated keys on an install tab are ignored", () => {
  const app = createHarness();
  let prevented = false;

  app.elements["install-tab-posix"].dispatch("keydown", {
    key: "Tab",
    preventDefault() {
      prevented = true;
    }
  });

  const state = installTabState(app);
  assert.equal(state.posixSelected, "true");
  assert.equal(state.powershellSelected, "false");
  assert.equal(prevented, false);
});

test("install tab copy buttons copy the exact one-command installers", async () => {
  const app = createHarness();

  app.installPosixCopyButton.dispatch("click");
  await settle();
  assert.equal(
    app.clipboardWrites[app.clipboardWrites.length - 1],
    "curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh"
  );

  app.installPowershellCopyButton.dispatch("click");
  await settle();
  assert.equal(
    app.clipboardWrites[app.clipboardWrites.length - 1],
    "irm https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.ps1 | iex"
  );
});

test("the Agent Skill copy button copies the exact skills CLI install command", async () => {
  const app = createHarness();

  app.agentSkillCopyButton.dispatch("click");
  await settle();
  assert.equal(
    app.clipboardWrites[app.clipboardWrites.length - 1],
    "npx skills add https://github.com/doggy8088/holidaybook/tree/master/skill"
  );
});
