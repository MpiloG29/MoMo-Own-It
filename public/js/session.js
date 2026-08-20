/**
 * Client-side stand-in for a real session.
 *
 * The backend has no authentication: buyers are identified by MSISDN alone and
 * every route is open. So "signed in" means nothing more than a remembered
 * phone number. Swap the storage below for a token from a real login endpoint
 * when one exists, and the rest of the pages keep working unchanged.
 */
window.Session = (function () {
  var KEY = 'momo.session';

  function read() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed.msisdn === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  return {
    start: function (msisdn) {
      var session = { msisdn: msisdn, signedInAt: new Date().toISOString() };
      window.sessionStorage.setItem(KEY, JSON.stringify(session));
      return session;
    },

    current: read,

    end: function () {
      window.sessionStorage.removeItem(KEY);
    },

    /** Sends the visitor to the login page unless a session exists. */
    requireSignedIn: function () {
      var session = read();
      if (!session) window.location.replace('/');
      return session;
    },
  };
})();
