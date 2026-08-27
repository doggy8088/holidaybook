/*
 * Taiwan Holiday Lookup client-side query tool.
 * Vanilla JS, no build step, no third-party dependencies.
 * Renders API-provided text with textContent only (never innerHTML).
 */
(function () {
  "use strict";

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  var form = document.getElementById("query-form");
  var dateInput = document.getElementById("date-input");
  var prevBtn = document.getElementById("prev-day");
  var nextBtn = document.getElementById("next-day");
  var todayBtn = document.getElementById("today-btn");
  var quickButtons = document.querySelectorAll(".quick-dates [data-offset]");

  var result = document.getElementById("result");
  var errorMessage = document.getElementById("error-message");
  var emptyMessage = document.getElementById("empty-message");
  var resultDate = document.getElementById("result-date");
  var resultBadge = document.getElementById("result-badge");
  var resultName = document.getElementById("result-name");
  var resultCategory = document.getElementById("result-category");
  var resultDescription = document.getElementById("result-description");
  var resultRaw = document.getElementById("result-raw");
  var themeToggle = document.getElementById("theme-toggle");

  var activeController = null;
  var activeDate = null;

  /* ---- Manual light/dark theme ---- */
  var THEME_STORAGE_KEY = "holidaybook-theme";
  var explicitTheme = null;
  var colorSchemeQuery = null;
  var colorSchemeListener = null;

  function readStoredTheme() {
    try {
      var stored = window.localStorage && window.localStorage.getItem(THEME_STORAGE_KEY);
      return stored === "light" || stored === "dark" ? stored : null;
    } catch (err) {
      return null;
    }
  }

  function updateTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (!themeToggle) return;

    var actionLabel = theme === "dark" ? "切換至淺色模式" : "切換至深色模式";
    themeToggle.textContent = actionLabel;
    themeToggle.setAttribute("aria-label", actionLabel);
    themeToggle.setAttribute("title", actionLabel);
    themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }

  function stopFollowingSystemTheme() {
    if (!colorSchemeQuery || !colorSchemeListener) return;
    if (typeof colorSchemeQuery.removeEventListener === "function") {
      colorSchemeQuery.removeEventListener("change", colorSchemeListener);
    } else if (typeof colorSchemeQuery.removeListener === "function") {
      colorSchemeQuery.removeListener(colorSchemeListener);
    }
    colorSchemeListener = null;
  }

  function initializeTheme() {
    explicitTheme = readStoredTheme();
    if (explicitTheme) {
      updateTheme(explicitTheme);
    } else {
      try {
        if (typeof window.matchMedia === "function") {
          colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        }
      } catch (err) {
        colorSchemeQuery = null;
      }

      updateTheme(colorSchemeQuery && colorSchemeQuery.matches ? "dark" : "light");
      if (colorSchemeQuery) {
        colorSchemeListener = function (event) {
          if (explicitTheme === null) {
            updateTheme(event.matches ? "dark" : "light");
          }
        };
        if (typeof colorSchemeQuery.addEventListener === "function") {
          colorSchemeQuery.addEventListener("change", colorSchemeListener);
        } else if (typeof colorSchemeQuery.addListener === "function") {
          colorSchemeQuery.addListener(colorSchemeListener);
        }
      }
    }

    if (themeToggle) {
      themeToggle.addEventListener("click", function () {
        explicitTheme =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        stopFollowingSystemTheme();
        updateTheme(explicitTheme);
        try {
          if (window.localStorage) {
            window.localStorage.setItem(THEME_STORAGE_KEY, explicitTheme);
          }
        } catch (err) {
          /* Theme still applies for this page when storage is unavailable. */
        }
      });
    }
  }

  initializeTheme();

  /** Returns today's date as YYYY-MM-DD in Asia/Taipei local time. */
  function getTaipeiToday() {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date());
      var map = {};
      for (var i = 0; i < parts.length; i++) {
        map[parts[i].type] = parts[i].value;
      }
      if (map.year && map.month && map.day) {
        return map.year + "-" + map.month + "-" + map.day;
      }
    } catch (err) {
      /* fall through to manual UTC+8 calculation below */
    }
    var now = new Date();
    var taipeiMs = now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000;
    var taipei = new Date(taipeiMs);
    return toDateStr(taipei);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toDateStr(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /** Validates a YYYY-MM-DD string, rejecting impossible dates like 2025-02-30. */
  function isValidDateStr(str) {
    if (!DATE_RE.test(str)) return false;
    var segments = str.split("-");
    var y = parseInt(segments[0], 10);
    var m = parseInt(segments[1], 10);
    var d = parseInt(segments[2], 10);
    var date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }

  function addDays(str, delta) {
    var segments = str.split("-");
    var date = new Date(Date.UTC(
      parseInt(segments[0], 10),
      parseInt(segments[1], 10) - 1,
      parseInt(segments[2], 10)
    ));
    date.setUTCDate(date.getUTCDate() + delta);
    return (
      date.getUTCFullYear() +
      "-" +
      pad2(date.getUTCMonth() + 1) +
      "-" +
      pad2(date.getUTCDate())
    );
  }

  function formatWeekday(str) {
    var segments = str.split("-");
    var date = new Date(Date.UTC(
      parseInt(segments[0], 10),
      parseInt(segments[1], 10) - 1,
      parseInt(segments[2], 10)
    ));
    try {
      return new Intl.DateTimeFormat("zh-Hant-TW", {
        weekday: "long",
        timeZone: "UTC"
      }).format(date);
    } catch (err) {
      return "";
    }
  }

  function setState(state) {
    result.setAttribute("data-state", state);
  }

  /** Returns a trimmed string only for genuine string fields, otherwise "". */
  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  /** Accepts the documented 0/1 (or boolean/string) holiday flag, else null. */
  function readHolidayFlag(value) {
    if (value === 1 || value === "1" || value === true) return true;
    if (value === 0 || value === "0" || value === false) return false;
    return null;
  }

  /** The static API reports dates as YYYYMMDD; accept YYYY-MM-DD defensively. */
  function matchesRequestedDate(value, dateStr) {
    var normalized = text(value).replace(/-/g, "");
    return normalized === dateStr.replace(/-/g, "");
  }

  function getQueryDate() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fromQuery = params.get("date");
      return fromQuery && isValidDateStr(fromQuery) ? fromQuery : null;
    } catch (err) {
      return null;
    }
  }

  function setQueryParam(dateStr, historyMode) {
    if (historyMode === "none") return;
    try {
      var url = new URL(window.location.href);
      if (historyMode === "push" && getQueryDate() === dateStr) return;
      url.searchParams.set("date", dateStr);
      if (historyMode === "push") {
        window.history.pushState(null, "", url.toString());
      } else {
        window.history.replaceState(null, "", url.toString());
      }
    } catch (err) {
      /* URL API unsupported: skip deep-linking, query still works */
    }
  }

  function getInitialDate() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fromQuery = params.get("date");
      if (fromQuery && isValidDateStr(fromQuery)) {
        return fromQuery;
      }
    } catch (err) {
      /* URLSearchParams unsupported: ignore and fall back to today */
    }
    return getTaipeiToday();
  }

  function renderSuccess(dateStr, data) {
    var weekday = formatWeekday(dateStr);
    resultDate.textContent = weekday ? dateStr + "（" + weekday + "）" : dateStr;

    var isHoliday = readHolidayFlag(data.isHoliday) === true;
    resultBadge.textContent = isHoliday ? "放假" : "上班";
    resultBadge.className = "badge " + (isHoliday ? "badge--holiday" : "badge--workday");

    resultName.textContent = text(data.name) || "（無特定假日名稱）";
    resultCategory.textContent = text(data.holidaycategory) || "（無）";
    resultDescription.textContent = text(data.description) || "（無）";

    resultRaw.textContent = JSON.stringify(data, null, 2);

    setState("success");
  }

  function renderEmpty(dateStr) {
    emptyMessage.textContent =
      "查無 " + dateStr + " 的資料，可能超出目前的資料涵蓋範圍（資料每日自動延伸，通常涵蓋近幾年）。";
    setState("empty");
  }

  function renderError(message) {
    errorMessage.textContent = message;
    setState("error");
  }

  function queryDate(dateStr, historyMode) {
    if (!isValidDateStr(dateStr)) {
      renderError("日期格式不正確，請使用 YYYY-MM-DD 格式，例如 2025-07-20。");
      return;
    }

    activeDate = dateStr;
    setQueryParam(dateStr, historyMode);
    setState("loading");

    if (activeController) {
      activeController.abort();
    }
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    activeController = controller;

    /* Aborting is best-effort: AbortController may be missing, or a polyfilled
       fetch may ignore the signal. activeDate is the authoritative guard, and
       every stage of the chain re-checks it: the headers arriving, the body
       finishing parsing, and any failure. Body parsing is itself asynchronous,
       so a newer query can start after the headers pass the guard. */
    function superseded() {
      return activeDate !== dateStr;
    }

    fetch(dateStr + ".json", {
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (superseded()) return null;
        if (response.status === 404) {
          renderEmpty(dateStr);
          return null;
        }
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (superseded()) return;
        if (data === null) return;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          renderError("回應格式不正確（預期單日 JSON 物件），請稍後再試一次。");
          return;
        }
        if (!matchesRequestedDate(data.date, dateStr)) {
          renderError("回應的日期與查詢的日期不符，請重新查詢一次。");
          return;
        }
        if (readHolidayFlag(data.isHoliday) === null) {
          renderError("回應缺少可辨識的 isHoliday 欄位，無法判斷放假狀態。");
          return;
        }
        renderSuccess(dateStr, data);
      })
      .catch(function (err) {
        if (superseded()) return;
        if (err && err.name === "AbortError") return;
        renderError("無法連線取得資料，請確認網路連線後再試一次（" + (err && err.message ? err.message : "未知錯誤") + "）。");
      });
  }

  function currentInputDate() {
    var value = dateInput.value;
    return isValidDateStr(value) ? value : getTaipeiToday();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    queryDate(dateInput.value, "push");
  });

  if (dateInput) {
    dateInput.addEventListener("change", function () {
      if (isValidDateStr(dateInput.value)) {
        queryDate(dateInput.value, "push");
      }
    });
  }

  prevBtn.addEventListener("click", function () {
    var next = addDays(currentInputDate(), -1);
    dateInput.value = next;
    queryDate(next, "push");
  });

  nextBtn.addEventListener("click", function () {
    var next = addDays(currentInputDate(), 1);
    dateInput.value = next;
    queryDate(next, "push");
  });

  todayBtn.addEventListener("click", function () {
    var today = getTaipeiToday();
    dateInput.value = today;
    queryDate(today, "push");
  });

  quickButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var offset = parseInt(btn.getAttribute("data-offset"), 10) || 0;
      var target = addDays(getTaipeiToday(), offset);
      dateInput.value = target;
      queryDate(target, "push");
    });
  });

  window.addEventListener("popstate", function () {
    var date = getQueryDate() || getTaipeiToday();
    dateInput.value = date;
    if (date === activeDate) return;
    queryDate(date, "none");
  });

  /* ---- Native install tabs: macOS/Linux vs Windows (PowerShell) ----
     Without JavaScript, the controls are hidden and both semantically ordinary
     install panels remain visible. Once every required element exists, this
     applies the complete WAI-ARIA relationship, enforces one visible panel,
     wires up keyboard handling, and only then reveals the controls. */
  var installTabList = document.getElementById("install-tabs-list");
  var installTabs = [
    {
      tabId: "install-tab-posix",
      panelId: "install-panel-posix",
      tab: document.getElementById("install-tab-posix"),
      panel: document.getElementById("install-panel-posix")
    },
    {
      tabId: "install-tab-powershell",
      panelId: "install-panel-powershell",
      tab: document.getElementById("install-tab-powershell"),
      panel: document.getElementById("install-panel-powershell")
    }
  ];

  if (
    installTabList &&
    installTabs[0].tab && installTabs[0].panel &&
    installTabs[1].tab && installTabs[1].panel
  ) {
    var activateInstallTab = function (index, moveFocus) {
      installTabs.forEach(function (entry, i) {
        var selected = i === index;
        entry.tab.setAttribute("aria-selected", selected ? "true" : "false");
        entry.tab.setAttribute("tabindex", selected ? "0" : "-1");
        if (selected) {
          entry.panel.removeAttribute("hidden");
        } else {
          entry.panel.setAttribute("hidden", "");
        }
      });
      if (moveFocus) {
        installTabs[index].tab.focus();
      }
    };

    installTabList.setAttribute("role", "tablist");
    installTabList.setAttribute("aria-labelledby", "install-heading");

    installTabs.forEach(function (entry, index) {
      entry.tab.setAttribute("role", "tab");
      entry.tab.setAttribute("aria-controls", entry.panelId);
      entry.panel.setAttribute("role", "tabpanel");
      entry.panel.setAttribute("aria-labelledby", entry.tabId);
      entry.panel.setAttribute("tabindex", "0");

      entry.tab.addEventListener("click", function () {
        activateInstallTab(index, false);
      });

      entry.tab.addEventListener("keydown", function (event) {
        var lastIndex = installTabs.length - 1;
        var targetIndex;
        switch (event.key) {
          case "ArrowRight":
            targetIndex = index === lastIndex ? 0 : index + 1;
            break;
          case "ArrowLeft":
            targetIndex = index === 0 ? lastIndex : index - 1;
            break;
          case "Home":
            targetIndex = 0;
            break;
          case "End":
            targetIndex = lastIndex;
            break;
          default:
            return;
        }
        event.preventDefault();
        activateInstallTab(targetIndex, true);
      });
    });

    activateInstallTab(0, false);
    installTabList.removeAttribute("hidden");
  }

  /* ---- Copy-to-clipboard for code samples and raw JSON ---- */
  document.querySelectorAll("[data-copy-target]").forEach(function (button) {
    var originalLabel = button.textContent;
    var restoreTimer = null;

    button.addEventListener("click", function () {
      var targetId = button.getAttribute("data-copy-target");
      var target = document.getElementById(targetId);
      if (!target) return;
      var text = target.textContent || "";

      var done = function (ok) {
        if (restoreTimer !== null) {
          window.clearTimeout(restoreTimer);
        }
        button.textContent = ok ? "已複製" : "複製失敗";
        restoreTimer = window.setTimeout(function () {
          button.textContent = originalLabel;
          restoreTimer = null;
        }, 1500);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { done(true); },
          function () { done(false); }
        );
        return;
      }

      try {
        var textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        done(ok);
      } catch (err) {
        done(false);
      }
    });
  });

  /* ---- Boot ---- */
  var initialDate = getInitialDate();
  dateInput.value = initialDate;
  queryDate(initialDate, "replace");
})();
