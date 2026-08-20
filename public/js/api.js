/**
 * What every page shares: one fetch wrapper that speaks this API's error shape,
 * one money formatter, and the top-bar session chrome.
 *
 * Calls are by path, never by origin — the same Express app serves these files
 * and `/api/v1`, so the UI follows the server's port and there is no CORS.
 */
window.MoMo = (function () {
  var BASE = '/api/v1';

  function request(method, path, body, base) {
    var init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return fetch((base === undefined ? BASE : base) + path, init).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch (_) {
          payload = null;
        }

        if (response.ok) return payload;

        // Every failure from this API is { error: { code, message, details } },
        // and the messages are already written for people to read.
        var failure = (payload && payload.error) || {};
        var error = new Error(failure.message || 'Request failed (' + response.status + ').');
        error.code = failure.code || 'HTTP_' + response.status;
        error.status = response.status;
        throw error;
      });
    });
  }

  /**
   * Cents are the wire format. Format for display only; never do maths on this.
   * Grouped by hand rather than by locale, so every browser shows one thing.
   */
  function money(cents) {
    var parts = (Number(cents) / 100).toFixed(2).split('.');
    return 'R\u00a0' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '.' + parts[1];
  }

  /** The inverse, for form fields: "3 000.50" typed by a human becomes 300050. */
  function toCents(value) {
    var amount = Number(String(value).replace(/[^\d.]/g, ''));
    return isFinite(amount) ? Math.round(amount * 100) : NaN;
  }

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char];
    });
  }

  function when(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString([], {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Fills the top bar from the session and wires sign-out, on any page that has them. */
  function mountSession(session) {
    var label = document.getElementById('session-msisdn');
    if (label) label.textContent = '+' + session.msisdn;

    var signOut = document.getElementById('sign-out');
    if (signOut) {
      signOut.addEventListener('click', function () {
        window.Session.end();
        window.location.replace('/');
      });
    }
  }

  function show(element, message) {
    if (!element) return;
    element.textContent = message || '';
    if (element.classList.contains('alert')) {
      element.classList.toggle('visible', Boolean(message));
    } else {
      element.hidden = !message;
    }
  }

  return {
    get: function (path) {
      return request('GET', path);
    },
    post: function (path, body) {
      return request('POST', path, body === undefined ? {} : body);
    },
    /** Webhooks sit outside /api/v1 — MoMo posts to them, and so does the demo. */
    postWebhook: function (path, body) {
      return request('POST', path, body === undefined ? {} : body, '');
    },
    money: money,
    toCents: toCents,
    esc: esc,
    when: when,
    mountSession: mountSession,
    show: show,
  };
})();
