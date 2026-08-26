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

  var activeController = null;

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

  function setQueryParam(dateStr) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set("date", dateStr);
      window.history.replaceState(null, "", url.toString());
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

  function queryDate(dateStr) {
    if (!isValidDateStr(dateStr)) {
      renderError("日期格式不正確，請使用 YYYY-MM-DD 格式，例如 2025-07-20。");
      return;
    }

    setQueryParam(dateStr);
    setState("loading");

    if (activeController) {
      activeController.abort();
    }
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    activeController = controller;

    fetch(dateStr + ".json", {
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
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
    queryDate(currentInputDate());
  });

  prevBtn.addEventListener("click", function () {
    var next = addDays(currentInputDate(), -1);
    dateInput.value = next;
    queryDate(next);
  });

  nextBtn.addEventListener("click", function () {
    var next = addDays(currentInputDate(), 1);
    dateInput.value = next;
    queryDate(next);
  });

  todayBtn.addEventListener("click", function () {
    var today = getTaipeiToday();
    dateInput.value = today;
    queryDate(today);
  });

  quickButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var offset = parseInt(btn.getAttribute("data-offset"), 10) || 0;
      var target = addDays(getTaipeiToday(), offset);
      dateInput.value = target;
      queryDate(target);
    });
  });

  /* ---- Copy-to-clipboard for code samples and raw JSON ---- */
  document.querySelectorAll("[data-copy-target]").forEach(function (button) {
    button.addEventListener("click", function () {
      var targetId = button.getAttribute("data-copy-target");
      var target = document.getElementById(targetId);
      if (!target) return;
      var text = target.textContent || "";

      var done = function (ok) {
        var original = button.textContent;
        button.textContent = ok ? "已複製" : "複製失敗";
        window.setTimeout(function () {
          button.textContent = original;
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
  queryDate(initialDate);
})();
