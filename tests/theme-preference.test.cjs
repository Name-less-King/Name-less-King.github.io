const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const storageKey = "theme-preference";
const source = fs.readFileSync(path.join(projectRoot, "_includes/head/theme-preference.js"), "utf8");

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options = {}) {
      const entries = listeners.get(type) || [];
      entries.push({ callback, once: options.once });
      listeners.set(type, entries);
    },
    fire(type, event = {}) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => !entry.once));
      for (const entry of entries) entry.callback(event);
    }
  };
}

function createBrowser(options = {}) {
  const store = new Map();
  if (options.stored !== undefined) store.set(storageKey, options.stored);
  if (options.legacy !== undefined) store.set("theme", options.legacy);
  const attributes = new Map();
  const root = {
    style: {},
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key)
  };
  const buttonAttributes = new Map();
  const button = {
    ...eventTarget(),
    setAttribute: (key, value) => buttonAttributes.set(key, value)
  };
  const iconClasses = new Set(["fa-solid", "theme-system"]);
  const icon = {
    classList: {
      add: (...classes) => classes.forEach((value) => iconClasses.add(value)),
      remove: (...classes) => classes.forEach((value) => iconClasses.delete(value))
    }
  };
  let mounted = options.ready === true;
  const document = {
    ...eventTarget(),
    documentElement: root,
    readyState: mounted ? "complete" : "loading",
    getElementById(id) {
      if (!mounted) return null;
      return id === "theme-cycle" ? button : id === "theme-icon" ? icon : null;
    }
  };
  const mediaEvents = eventTarget();
  const media = { matches: options.dark === true };
  if (options.legacyMedia) {
    media.addListener = (callback) => mediaEvents.addEventListener("change", callback);
  } else {
    media.addEventListener = mediaEvents.addEventListener;
  }
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem(key, value) {
      if (options.writeBlocked) throw new Error("Storage write blocked");
      store.set(key, value);
    }
  };
  const window = {
    ...eventTarget(),
    matchMedia(query) {
      assert.equal(query, "(prefers-color-scheme: dark)");
      return media;
    }
  };
  Object.defineProperty(window, "localStorage", {
    get() {
      if (options.storageBlocked) throw new Error("Storage access blocked");
      return storage;
    }
  });
  vm.runInNewContext(source, { window, document });

  return {
    store, attributes, root, buttonAttributes, iconClasses, window,
    theme: () => attributes.get("data-theme") || "light",
    preference: () => attributes.get("data-theme-preference"),
    ready() {
      mounted = true;
      document.readyState = "interactive";
      document.fire("DOMContentLoaded");
    },
    click() {
      button.fire("click");
    },
    changeSystem(dark) {
      media.matches = dark;
      mediaEvents.fire("change", { matches: dark });
    }
  };
}

for (const dark of [false, true]) {
  for (const stored of [undefined, "system"]) {
    test(`system preference (${stored ?? "new visitor"}) starts in ${dark ? "dark" : "light"} before the DOM is ready`, () => {
      const browser = createBrowser({ dark, stored });
      assert.equal(browser.preference(), "system");
      assert.equal(browser.theme(), dark ? "dark" : "light");
      assert.equal(browser.root.style.colorScheme, browser.theme());
      browser.ready();
      assert.equal(browser.buttonAttributes.get("title"), "Color theme: System. Switch to Light.");
      assert.ok(browser.iconClasses.has("theme-system"));
      browser.changeSystem(!dark);
      assert.equal(browser.theme(), dark ? "light" : "dark");
      assert.equal(browser.preference(), "system");
      assert.equal(browser.window.siteTheme.getComputedTheme(), browser.theme());
    });
  }
}

for (const stored of ["light", "dark"]) {
  test(`saved three-state ${stored} preferences remain fixed across system changes`, () => {
    const browser = createBrowser({ stored, dark: stored !== "dark" });
    browser.ready();
    assert.equal(browser.theme(), stored);
    assert.equal(browser.preference(), stored);
    assert.ok(browser.iconClasses.has(stored === "dark" ? "fa-moon" : "fa-sun"));
    browser.changeSystem(true);
    assert.equal(browser.theme(), stored);
    browser.changeSystem(false);
    assert.equal(browser.theme(), stored);
  });
}

test("one button cycles System, Light, Dark and back to live System mode", () => {
  const browser = createBrowser({ dark: true });
  browser.ready();
  for (const value of ["light", "dark", "system", "light", "dark", "system"]) {
    browser.click();
    assert.equal(browser.store.get(storageKey), value);
    assert.equal(browser.preference(), value);
    assert.equal(browser.theme(), value === "system" ? "dark" : value);
    assert.equal(browser.root.style.colorScheme, browser.theme());
    const expectedIcon = { system: "theme-system", light: "fa-sun", dark: "fa-moon" }[value];
    assert.deepEqual([...browser.iconClasses].sort(), ["fa-solid", expectedIcon].sort());
    const label = browser.buttonAttributes.get("aria-label");
    assert.equal(label, browser.buttonAttributes.get("title"));
    assert.match(label, new RegExp("Color theme: " + value, "i"));
  }
  browser.changeSystem(false);
  assert.equal(browser.theme(), "light");
  assert.equal(browser.preference(), "system");
  assert.ok(browser.iconClasses.has("theme-system"));
  assert.equal(browser.iconClasses.size, 2);
});

test("a saved system preference is restored and still responds after navigating to another page", () => {
  const firstPage = createBrowser({ stored: "dark", dark: false });
  firstPage.ready();
  firstPage.click();
  const nextPage = createBrowser({ stored: firstPage.store.get(storageKey), dark: false });
  assert.equal(nextPage.theme(), "light");
  nextPage.changeSystem(true);
  assert.equal(nextPage.theme(), "dark");
});

test("invalid stored preferences fall back to system", () => {
  const browser = createBrowser({ stored: "invalid", dark: true, ready: true });
  assert.equal(browser.preference(), "system");
  assert.equal(browser.preference(), "system");
  browser.changeSystem(false);
  assert.equal(browser.theme(), "light");
});

test("theme changes synchronize across tabs, and clearing preferences restores system mode", () => {
  const browser = createBrowser({ dark: false, ready: true });
  browser.store.set(storageKey, "dark");
  browser.window.fire("storage", { key: "unrelated" });
  assert.equal(browser.theme(), "light");
  browser.window.fire("storage", { key: storageKey });
  assert.equal(browser.theme(), "dark");
  assert.equal(browser.preference(), "dark");
  assert.equal(browser.buttonAttributes.get("title"), "Color theme: Dark. Switch to System.");
  browser.store.set(storageKey, "system");
  browser.window.fire("storage", { key: storageKey });
  assert.equal(browser.theme(), "light");
  browser.changeSystem(true);
  assert.equal(browser.theme(), "dark");
  browser.store.clear();
  browser.window.fire("storage", { key: null });
  assert.equal(browser.preference(), "system");
  assert.equal(browser.buttonAttributes.get("title"), "Color theme: System. Switch to Light.");
});

test("restored back-forward pages read the latest preference", () => {
  const browser = createBrowser({ dark: true, ready: true });
  browser.store.set(storageKey, "light");
  browser.window.fire("pageshow", { persisted: true });
  assert.equal(browser.theme(), "light");
  assert.equal(browser.buttonAttributes.get("title"), "Color theme: Light. Switch to Dark.");
});

for (const restriction of ["storageBlocked", "writeBlocked"]) {
  test(`theme controls still work when ${restriction}`, () => {
    const browser = createBrowser({ [restriction]: true, dark: true, ready: true });
    assert.equal(browser.theme(), "dark");
    browser.click();
    assert.equal(browser.theme(), "light");
    browser.changeSystem(true);
    assert.equal(browser.theme(), "light");
    browser.click();
    assert.equal(browser.theme(), "dark");
    browser.click();
    assert.equal(browser.theme(), "dark");
    browser.changeSystem(false);
    assert.equal(browser.theme(), "light");
  });
}

test("older MediaQueryList listeners still follow system changes", () => {
  const browser = createBrowser({ legacyMedia: true, ready: true });
  browser.changeSystem(true);
  assert.equal(browser.theme(), "dark");
  browser.changeSystem(false);
  assert.equal(browser.theme(), "light");
});

test("legacy two-state choices do not override the new default System mode", () => {
  for (const legacy of ["light", "dark"]) {
    const browser = createBrowser({ legacy, dark: legacy === "light", ready: true });
    assert.equal(browser.preference(), "system");
    assert.equal(browser.theme(), legacy === "light" ? "dark" : "light");
    browser.window.fire("storage", { key: "theme" });
    assert.equal(browser.preference(), "system");
  }
});

test("all pages share a single accessible icon button and early theme initialization", () => {
  const head = fs.readFileSync(path.join(projectRoot, "_includes/head.html"), "utf8");
  const masthead = fs.readFileSync(path.join(projectRoot, "_includes/masthead.html"), "utf8");
  const scripts = fs.readFileSync(path.join(projectRoot, "_includes/scripts.html"), "utf8");
  assert.ok(head.indexOf("{% include head/theme-preference.js %}") < head.indexOf("/assets/css/main.css"));
  assert.ok(head.includes("/assets/css/main.css?v={{ site.asset_version }}"));
  assert.ok(scripts.includes("/assets/js/main.min.js?v={{ site.asset_version }}"));
  assert.equal((masthead.match(/<button id="theme-cycle"/g) || []).length, 1);
  assert.match(masthead, /<button id="theme-cycle" type="button" aria-label="Color theme: System\. Switch to Light\."/);
  assert.doesNotMatch(masthead, /<select/);
  const navigation = fs.readFileSync(path.join(projectRoot, "assets/js/plugins/jquery.greedy-navigation.js"), "utf8");
  assert.ok(navigation.includes("$('#site-nav > button')"));
  assert.ok(!navigation.includes("$('#site-nav button')"));
});

test("the shipped main bundle no longer contains the old two-state theme toggle", () => {
  const bundle = fs.readFileSync(path.join(projectRoot, "assets/js/main.min.js"), "utf8");
  assert.doesNotMatch(bundle, /toggleTheme|determineThemeSetting|localStorage\.setItem\("theme"/);
  assert.match(bundle, /window\.siteTheme\.getComputedTheme\(\)/);
});

test("theme button styles prevent native click artifacts and keep keyboard focus visible", () => {
  const navigation = fs.readFileSync(path.join(projectRoot, "_sass/layout/_navigation.scss"), "utf8");
  const start = navigation.indexOf("    #theme-toggle {");
  const styles = navigation.slice(start, navigation.indexOf("\n    a {", start));
  const button = styles.slice(0, styles.indexOf("&:hover"));
  assert.match(button, /-webkit-appearance:\s*none;/);
  assert.match(button, /\bappearance:\s*none;/);
  assert.match(button, /outline:\s*none;/);
  assert.match(button, /overflow:\s*visible;/);
  assert.match(button, /min-width:\s*1\.75rem;/);
  assert.match(button, /line-height:\s*1;/);
  assert.match(button, /-webkit-user-select:\s*none;/);
  assert.match(button, /\buser-select:\s*none;/);
  assert.match(button, /caret-color:\s*transparent;/);
  assert.match(styles, /&:focus-visible\s*\{\s*outline:\s*2px solid var\(--global-link-color\);/);
  const icon = styles.slice(styles.indexOf("#theme-icon {"));
  assert.match(icon, /flex:\s*0 0 1\.25em;/);
  assert.match(icon, /width:\s*1\.25em;/);
  assert.match(icon, /pointer-events:\s*none;/);
});

test("System uses a transparent half-sun SVG only in system mode", () => {
  const masthead = fs.readFileSync(path.join(projectRoot, "_includes/masthead.html"), "utf8");
  const navigation = fs.readFileSync(path.join(projectRoot, "_sass/layout/_navigation.scss"), "utf8");
  assert.match(masthead, /id="theme-icon" class="fa-solid theme-system" aria-hidden="true"/);
  assert.match(masthead, /<svg class="theme-system-glyph"[^>]*viewBox="0 0 24 24"[^>]*fill="currentColor"[^>]*focusable="false"/);
  assert.equal((masthead.match(/<svg class="theme-system-glyph"/g) || []).length, 1);
  assert.match(navigation, /\.theme-system-glyph\s*\{\s*display:\s*none;/);
  assert.match(navigation, /&\.theme-system \.theme-system-glyph\s*\{\s*display:\s*block;/);
  assert.doesNotMatch(masthead + source, /fa-desktop/);
});

test("System icon compensates for SVG padding without changing the button size", () => {
  const masthead = fs.readFileSync(path.join(projectRoot, "_includes/masthead.html"), "utf8");
  const navigation = fs.readFileSync(path.join(projectRoot, "_sass/layout/_navigation.scss"), "utf8");
  const glyph = navigation.match(/\.theme-system-glyph\s*\{([^}]+)\}/)[1];
  assert.match(glyph, /width:\s*1\.1em;/);
  assert.match(glyph, /height:\s*1\.1em;/);
  assert.match(glyph, /margin:\s*0 auto;/);
  assert.match(masthead, /class="theme-system-glyph"[^>]*width="1\.1em" height="1\.1em"/);
  // Existing sun: 516 font units at 512 units/em; SVG: 22 units in a 24-unit canvas.
  assert.ok(Math.abs(1.1 * 22 / 24 - 516 / 512) < 0.001);
});
