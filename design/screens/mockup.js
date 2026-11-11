// Review controls for the mockups: light or dark mode, the screen's states, and a note for
// controls whose result has no mockup of its own. None of this is part of the app.
(() => {
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = "system";
  try {
    theme = localStorage.getItem("jagra-mockup-theme") ?? "system";
  } catch {
    // Storage can be blocked for local files; the system setting is used then.
  }

  const applyTheme = () => {
    const dark = theme === "dark" || (theme === "system" && system.matches);
    root.classList.toggle("dark", dark);
    for (const button of document.querySelectorAll("[data-theme-choice]")) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
    }
  };
  system.addEventListener("change", applyTheme);

  const showState = (name) => {
    if (window.self !== window.top) {
      window.parent.postMessage({ source: "jagra-mockup", state: name }, "*");
    }
    for (const element of document.querySelectorAll("[data-state]")) {
      element.hidden = !element.dataset.state.split(" ").includes(name);
    }
    for (const button of document.querySelectorAll("[data-show]")) {
      button.setAttribute("aria-pressed", String(button.dataset.show === name));
    }
  };

  const note = document.createElement("div");
  note.className = "review-note";
  note.setAttribute("role", "status");
  note.hidden = true;
  let timer;
  const say = (text) => {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => (note.hidden = true), 4000);
  };

  // Tabs inside a screen: arrow keys move between them, as in the app.
  const selectTab = (tab) => {
    const list = tab.closest("[role=tablist]");
    for (const other of list.querySelectorAll("[role=tab]")) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    }
  };

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-theme-choice], [data-show], [data-note], [role=tab]");
    if (!target) return;
    if (target.dataset.themeChoice) {
      theme = target.dataset.themeChoice;
      try {
        localStorage.setItem("jagra-mockup-theme", theme);
      } catch {
        // Not kept between pages then.
      }
      applyTheme();
    } else if (target.dataset.show) {
      showState(target.dataset.show);
    } else if (target.dataset.note) {
      event.preventDefault();
      say(`Di aplikasi: ${target.dataset.note}`);
    } else {
      selectTab(target);
    }
  });

  document.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.("[role=tab]");
    if (tab && (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft")) {
      const tabs = [...tab.closest("[role=tablist]").querySelectorAll("[role=tab]")];
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      selectTab(next);
      next.focus();
      event.preventDefault();
    }
    if (event.key === "Escape") note.hidden = true;
  });

  // Inside the viewer (index.html), the viewer chooses the theme and the state, so the review
  // bar is hidden and the page reports which screen it is.
  const embedded = window.self !== window.top;
  if (embedded) root.classList.add("embedded");
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "jagra-viewer") return;
    if (data.theme) {
      theme = data.theme;
      applyTheme();
    }
    if (data.state) showState(data.state);
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.body.append(note);
    applyTheme();
    const first = document.querySelector("[data-show]");
    if (first) showState(first.dataset.show);
    if (embedded) {
      window.parent.postMessage(
        { source: "jagra-mockup", file: location.pathname.split("/").pop() },
        "*",
      );
    }
  });
  applyTheme();
})();
