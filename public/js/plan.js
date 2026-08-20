/**
 * One plan: progress, what a miss costs, the ledger, and either the unlock code
 * (Use It) or the collection code and payout (Reserve).
 *
 * `GET /plans/:id` returns all of it in one response — plan, item, computed
 * progress, every payment, unlock state and payout state — so this page reads
 * the engine's answers rather than working anything out for itself.
 */
(function () {
  var session = window.Session.requireSignedIn();
  if (!session) return;
  window.MoMo.mountSession(session);

  var MODE_LABEL = { reserve: 'Reserve', use_it: 'Use It' };
  var SETTLE_ATTEMPTS = 6;
  var SETTLE_DELAY_MS = 800;

  var params = new URLSearchParams(window.location.search);
  var planId = params.get('id');
  /** Only collections this browser started may be chased for an outcome. */
  var mayChase = params.get('await') === '1';

  var view = document.getElementById('plan-view');
  var status = document.getElementById('plan-status');
  var alertBox = document.getElementById('plan-alert');

  if (!planId) {
    window.MoMo.show(status, '');
    window.MoMo.show(alertBox, 'No plan was chosen.');
    return;
  }

  load();

  function load() {
    window.MoMo
      .get('/plans/' + encodeURIComponent(planId))
      .then(render)
      .catch(function (error) {
        window.MoMo.show(status, '');
        window.MoMo.show(alertBox, error.message);
      });
  }

  function render(data) {
    var plan = data.plan;
    var progress = data.progress;

    document.getElementById('plan-title').textContent = data.item ? data.item.title : 'Your plan';

    var mode = document.getElementById('plan-mode');
    mode.textContent = MODE_LABEL[plan.mode] || plan.mode;
    mode.className = 'tag tag-' + plan.mode;

    var pill = document.getElementById('plan-pill');
    pill.textContent = plan.status;
    pill.className = 'pill pill-' + plan.status;

    document.getElementById('plan-bar').style.width = progress.percent + '%';
    document.getElementById('plan-progress').innerHTML =
      '<strong>' +
      window.MoMo.money(progress.paidCents) +
      '</strong> of ' +
      window.MoMo.money(plan.totalCents) +
      ' paid — ' +
      progress.percent +
      '%' +
      (progress.remainingCents
        ? ', ' +
          window.MoMo.money(progress.remainingCents) +
          ' left over about ' +
          progress.weeksRemaining +
          ' weeks'
        : ', paid off');

    document.getElementById('plan-facts').innerHTML = facts(plan, progress);
    document.getElementById('plan-possession').innerHTML = possession(plan, data.unlock, data.disbursement);
    document.getElementById('plan-ledger').innerHTML = ledger(data.payments || []);

    renderActions(plan, data.payments || []);

    window.MoMo.show(status, '');
    view.hidden = false;
  }

  function fact(title, value, note) {
    return (
      '<div class="panel"><h3>' +
      window.MoMo.esc(title) +
      '</h3><p class="value">' +
      value +
      '</p>' +
      (note ? '<p><small>' + note + '</small></p>' : '') +
      '</div>'
    );
  }

  function facts(plan, progress) {
    return (
      fact('Weekly instalment', window.MoMo.money(plan.weeklyAmountCents), 'over ' + plan.weeks + ' weeks') +
      fact(
        'Next payment due',
        plan.nextDueAt ? window.MoMo.when(plan.nextDueAt) : 'Nothing due',
        plan.status === 'complete' ? 'This plan is finished' : 'Collected automatically',
      ) +
      fact(
        'Weeks missed',
        String(plan.missedCount),
        plan.mode === 'use_it'
          ? 'A miss darkens the device until the next payment'
          : 'A miss stretches the plan; nothing is lost',
      ) +
      fact('Started', window.MoMo.when(plan.startedAt), 'Progress ' + progress.percent + '%')
    );
  }

  /** Fork one of two, as the buyer experiences it: who holds the thing. */
  function possession(plan, unlock, disbursement) {
    if (plan.mode === 'use_it') return unlockPanel(plan, unlock);

    if (plan.status !== 'complete') {
      return (
        '<div class="panel notice"><h3>Held by your supplier</h3>' +
        '<p>Your supplier keeps this until the final instalment clears. Miss a week and the plan ' +
        'simply stretches — nothing is lost and nothing is charged for it.</p></div>'
      );
    }

    return (
      '<div class="panel notice is-good"><h3>Ready to collect</h3>' +
      '<p>Show this code at the counter.</p>' +
      '<p class="code">' +
      window.MoMo.esc(plan.collectionCode || '—') +
      '</p>' +
      '<p><small>Supplier payout: ' +
      '<span class="pill pill-' +
      (disbursement ? disbursement.status : 'pending') +
      '">' +
      (disbursement ? disbursement.status : 'not raised') +
      '</span></small></p></div>'
    );
  }

  function unlockPanel(plan, unlock) {
    if (!unlock || (!unlock.code && !unlock.locked)) {
      return (
        '<div class="panel notice"><h3>Device code</h3>' +
        '<p>The first successful payment issues your first unlock code.</p></div>'
      );
    }

    if (unlock.permanentlyUnlocked) {
      return (
        '<div class="panel notice is-good"><h3>Unlocked for good</h3>' +
        '<p class="code">' +
        window.MoMo.esc(unlock.code.code) +
        '</p>' +
        '<p>Paid off. Enter this once and the device stops asking, forever.</p></div>'
      );
    }

    if (unlock.locked) {
      return (
        '<div class="panel notice is-bad"><h3>Device locked</h3>' +
        '<p>The last code ran out on ' +
        window.MoMo.when(unlock.code ? unlock.code.expiresAt : null) +
        '. The next successful payment issues a new one — no penalty, no arrears.</p></div>'
      );
    }

    return (
      '<div class="panel notice is-good"><h3>Current device code</h3>' +
      '<p class="code">' +
      window.MoMo.esc(unlock.code.code) +
      '</p>' +
      '<p>Type it into the keypad. Valid until ' +
      window.MoMo.when(unlock.code.expiresAt) +
      ' (code ' +
      unlock.code.sequence +
      ').</p>' +
      '<p><small>Codes work offline: no signal, no data, no smartphone.</small></p>' +
      '<a class="btn btn-ghost" href="/device?plan=' +
      encodeURIComponent(plan.id) +
      '">Open the device keypad</a></div>'
    );
  }

  function ledger(payments) {
    if (!payments.length) return '<p class="item-note">No payments yet.</p>';

    return (
      '<table class="ledger"><thead><tr><th>Requested</th><th>Amount</th><th>Outcome</th></tr></thead><tbody>' +
      payments
        .slice()
        .reverse()
        .map(function (payment) {
          return (
            '<tr><td>' +
            window.MoMo.when(payment.createdAt) +
            '</td><td>' +
            window.MoMo.money(payment.amountCents) +
            '</td><td><span class="pill pill-' +
            payment.status +
            '">' +
            payment.status +
            '</span>' +
            (payment.failureReason
              ? ' <small>' + window.MoMo.esc(payment.failureReason) + '</small>'
              : '') +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>'
    );
  }

  function renderActions(plan, payments) {
    var actions = document.getElementById('plan-actions');
    var pending = payments.filter(function (payment) {
      return payment.status === 'pending';
    });

    if (pending.length) {
      actions.innerHTML =
        '<div class="panel notice"><h3>Waiting for MoMo</h3><p id="await-note">' +
        'A collection of ' +
        window.MoMo.money(pending[0].amountCents) +
        ' is awaiting confirmation. Nothing is applied to the plan until it clears.</p></div>';

      if (mayChase) chase(1);
      return;
    }

    if (plan.status === 'complete') {
      actions.innerHTML = '';
      return;
    }

    var amount = Math.min(plan.weeklyAmountCents, plan.totalCents - plan.paidCents);
    actions.innerHTML =
      '<button class="btn btn-wide" type="button" id="pay-ahead">Pay a week early (' +
      window.MoMo.money(amount) +
      ')</button>';

    document.getElementById('pay-ahead').addEventListener('click', payAhead);
  }

  function payAhead() {
    var button = document.getElementById('pay-ahead');
    button.disabled = true;
    button.textContent = 'Requesting…';
    window.MoMo.show(alertBox, '');

    window.MoMo
      .post('/plans/' + encodeURIComponent(planId) + '/pay-ahead', {})
      .then(function () {
        mayChase = true;
        load();
      })
      .catch(function (error) {
        window.MoMo.show(alertBox, error.message);
        button.disabled = false;
        button.textContent = 'Pay a week early';
      });
  }

  /**
   * Ask MoMo how our in-flight collection resolved.
   *
   * Under the mock provider nothing calls back, and in production a callback can
   * be dropped — either way the poller is what settles it. This is the same
   * reconcile the scheduler runs, narrowed to this one plan.
   */
  function chase(attempt) {
    var note = document.getElementById('await-note');
    if (note) note.textContent = 'Confirming your payment with MoMo…';

    window.MoMo
      .post('/demo/plans/' + encodeURIComponent(planId) + '/settle')
      .then(function (result) {
        if (result && result.settled) {
          clearAwaitFlag();
          load();
          return;
        }
        if (attempt >= SETTLE_ATTEMPTS) {
          clearAwaitFlag();
          if (note) {
            note.textContent =
              'Still awaiting confirmation. It will settle on the next collection cycle.';
          }
          return;
        }
        window.setTimeout(function () {
          chase(attempt + 1);
        }, SETTLE_DELAY_MS);
      })
      .catch(function (error) {
        clearAwaitFlag();
        window.MoMo.show(alertBox, error.message);
      });
  }

  function clearAwaitFlag() {
    mayChase = false;
    window.history.replaceState({}, '', '/plan?id=' + encodeURIComponent(planId));
  }
})();
