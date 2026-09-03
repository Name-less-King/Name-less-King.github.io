(function () {
  "use strict";

  const root = document.documentElement;
  /* A new key avoids carrying the old two-state toggle's override into System mode. */
  const storageKey = "theme-preference";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const icons = { system: "fa-desktop", light: "fa-sun", dark: "fa-moon" };
  const labels = { system: "System", light: "Light", dark: "Dark" };
  const nextPreference = { system: "light", light: "dark", dark: "system" };

  function normalizePreference(value) {
    return value === "light" || value === "dark" ? value : "system";
  }

  function readPreference(fallback) {
    try {
      return normalizePreference(window.localStorage.getItem(storageKey));
    } catch (error) {
      return fallback;
    }
  }

  let preference = readPreference("system");

  function getComputedTheme() {
    return preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference;
  }

  function applyTheme() {
    const theme = getComputedTheme();
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
    root.setAttribute("data-theme-preference", preference);
    root.style.colorScheme = theme;

    const button = document.getElementById("theme-cycle");
    if (button) {
      const label = "Color theme: " + labels[preference] + ". Switch to " + labels[nextPreference[preference]] + ".";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    }

    const icon = document.getElementById("theme-icon");
    if (icon) {
      icon.classList.remove("fa-desktop", "fa-sun", "fa-moon");
      icon.classList.add(icons[preference]);
    }
  }

  function setPreference(value) {
    preference = normalizePreference(value);
    try {
      window.localStorage.setItem(storageKey, preference);
    } catch (error) {
      /* Keep the current page usable when browser storage is unavailable. */
    }
    applyTheme();
  }

  window.siteTheme = Object.freeze({
    getPreference: () => preference,
    getComputedTheme: getComputedTheme,
    setPreference: setPreference
  });

  /* Apply before the stylesheet is loaded, not after the page is painted. */
  applyTheme();

  function onSystemThemeChange() {
    if (preference === "system") applyTheme();
  }
  if (systemTheme.addEventListener) {
    systemTheme.addEventListener("change", onSystemThemeChange);
  } else {
    systemTheme.addListener(onSystemThemeChange);
  }

  /* Share the preference across open tabs and restored navigation entries. */
  window.addEventListener("storage", function (event) {
    if (event.key === storageKey || event.key === null) {
      preference = readPreference(preference);
      applyTheme();
    }
  });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      preference = readPreference(preference);
      applyTheme();
    }
  });

  function initializeButton() {
    const button = document.getElementById("theme-cycle");
    if (button) {
      button.addEventListener("click", function () {
        setPreference(nextPreference[preference]);
      });
    }
    applyTheme();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeButton, { once: true });
  } else {
    initializeButton();
  }
})();
