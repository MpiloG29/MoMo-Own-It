/**
 * The repayment record.
 *
 * Every number here is a query over what happened, computed by the API. The
 * page adds no interpretation of its own — no score, no rating, no advice.
 */
(function () {
  var session = window.Session.requireSignedIn();
  if (!session) return;
  window.MoMo.mountSession(session);

  var status = document.getElementById('record-status');
  var alertBox = document.getElementById('record-alert');
  var cards = document.getElementById('record-cards');
  var actions = document.getElementById('record-actions');

  window.MoMo
    .get('/records/' + encodeURIComponent(session.msisdn))
    .then(render)
    .catch(function (error) {
      window.MoMo.show(status, '');
      window.MoMo.show(alertBox, error.message);
    });

  function render(record) {
    var settled = record.paymentsOnTime + record.paymentsLate;

    cards.innerHTML =
      card('Plans paid off', String(record.plansCompleted), 'running now: ' + record.plansActive) +
      card('Payments made', String(settled), record.paymentsLate + ' landed late') +
      card(
        'On-time rate',
        settled ? Math.round(record.onTimeRate * 100) + '%' : '—',
        settled ? 'of ' + settled + ' payments' : 'no payments yet',
      ) +
      card('Total repaid', window.MoMo.money(record.totalRepaidCents), 'across every plan') +
      card('First plan', window.MoMo.when(record.firstPlanAt), 'when this record starts') +
      card('Most recent plan', window.MoMo.when(record.lastPlanAt), 'last time you started one');

    document.getElementById('record-download').href =
      '/api/v1/records/' + encodeURIComponent(session.msisdn) + '/export';

    actions.hidden = false;
    window.MoMo.show(status, '');
  }

  function card(title, value, note) {
    return (
      '<div class="panel"><h3>' +
      window.MoMo.esc(title) +
      '</h3><p class="value">' +
      window.MoMo.esc(value) +
      '</p><p><small>' +
      window.MoMo.esc(note) +
      '</small></p></div>'
    );
  }
})();
