/**
 * Presenter controls: the demo endpoints with buttons on them.
 *
 * Four things can be done to a plan, in rising order of bluntness:
 *   collect now   — request the next instalment early
 *   confirm       — post the callback MoMo would have posted
 *   ask MoMo      — reconcile this plan's in-flight collection
 *   force a miss  — fail the in-flight payment, and the lamp goes dark
 */
(function () {
  var MODE_LABEL = { reserve: 'Reserve', use_it: 'Use It' };

  var status = document.getElementById('demo-status');
  var alertBox = document.getElementById('demo-alert');
  var plansBox = document.getElementById('demo-plans');

  fetch('/health')
    .then(function (response) {
      return response.json();
    })
    .then(function (health) {
      document.getElementById('demo-health').innerHTML =
        card('Database', health.db) +
        card('MoMo provider', health.momoProvider) +
        card('One "week" is', health.billingPeriodSeconds + 's') +
        card('Status', health.status);
    })
    .catch(function () {
      window.MoMo.show(alertBox, 'The server is not answering /health.');
    });

  document.getElementById('run-tick').addEventListener('click', function () {
    var button = this;
    var note = document.getElementById('tick-result');

    button.disabled = true;
    button.textContent = 'Running…';

    window.MoMo
      .post('/demo/tick')
      .then(function (result) {
        note.hidden = false;
        note.textContent =
          'Collected ' +
          result.collected.length +
          ', settled ' +
          result.settled +
          ', payouts ' +
          result.disbursed +
          '.';
        load();
      })
      .catch(function (error) {
        window.MoMo.show(alertBox, error.message);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = 'Run one collection cycle';
      });
  });

  load();

  function load() {
    window.MoMo
      .get('/suppliers')
      .then(function (suppliers) {
        return Promise.all(
          suppliers.map(function (supplier) {
            return window.MoMo.get('/suppliers/' + encodeURIComponent(supplier.id) + '/plans');
          }),
        );
      })
      .then(function (dashboards) {
        var rows = [];

        dashboards.forEach(function (dashboard) {
          var titles = {};
          dashboard.items.forEach(function (item) {
            titles[item.id] = item.title;
          });

          dashboard.plans.forEach(function (plan) {
            rows.push({ plan: plan, title: titles[plan.itemId] || 'Item', supplier: dashboard.supplier.name });
          });
        });

        if (!rows.length) {
          window.MoMo.show(status, 'No plans yet. Run "npm run seed".');
          return;
        }

        plansBox.innerHTML = rows.map(rowMarkup).join('');
        window.MoMo.show(status, '');
      })
      .catch(function (error) {
        window.MoMo.show(status, '');
        window.MoMo.show(alertBox, error.message);
      });
  }

  function rowMarkup(entry) {
    var plan = entry.plan;
    var percent = plan.totalCents ? Math.round((plan.paidCents / plan.totalCents) * 100) : 0;
    var done = plan.status === 'complete';

    return (
      '<div class="control-row" data-plan="' +
      window.MoMo.esc(plan.id) +
      '">' +
      '<div class="control-head">' +
      '<strong>' +
      window.MoMo.esc(entry.title) +
      '</strong>' +
      '<span class="tag tag-' +
      window.MoMo.esc(plan.mode) +
      '">' +
      window.MoMo.esc(MODE_LABEL[plan.mode] || plan.mode) +
      '</span>' +
      '<span class="pill pill-' +
      window.MoMo.esc(plan.status) +
      '">' +
      window.MoMo.esc(plan.status) +
      '</span>' +
      '<small>+' +
      window.MoMo.esc(plan.buyerMsisdn) +
      ' · ' +
      window.MoMo.money(plan.paidCents) +
      ' of ' +
      window.MoMo.money(plan.totalCents) +
      ' · ' +
      percent +
      '%' +
      (plan.missedCount ? ' · ' + plan.missedCount + ' missed' : '') +
      '</small>' +
      '</div>' +
      '<div class="control-actions">' +
      '<a class="btn btn-ghost" href="/plan?id=' +
      window.MoMo.esc(plan.id) +
      '">Open</a>' +
      (done
        ? ''
        : '<button class="btn btn-ghost" type="button" data-act="collect">Collect now</button>' +
          '<button class="btn btn-ghost" type="button" data-act="confirm">Confirm as MoMo</button>' +
          '<button class="btn btn-ghost" type="button" data-act="settle">Ask MoMo</button>' +
          '<button class="btn btn-ghost is-danger" type="button" data-act="miss">Force a miss</button>') +
      '</div>' +
      '<p class="control-note" hidden></p>' +
      '</div>'
    );
  }

  plansBox.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-act]');
    if (!button) return;

    var row = button.closest('.control-row');
    var planId = row.getAttribute('data-plan');
    var note = row.querySelector('.control-note');
    var action = button.getAttribute('data-act');

    window.MoMo.show(alertBox, '');
    note.hidden = false;
    note.textContent = 'Working…';

    act(action, planId)
      .then(function (message) {
        note.textContent = message;
        load();
      })
      .catch(function (error) {
        note.textContent = error.message;
      });
  });

  function act(action, planId) {
    if (action === 'collect') {
      return window.MoMo.post('/demo/plans/' + planId + '/collect-now').then(function (result) {
        return 'Requested ' + window.MoMo.money(result.amountCents) + ', awaiting confirmation.';
      });
    }

    if (action === 'settle') {
      return window.MoMo.post('/demo/plans/' + planId + '/settle').then(function (result) {
        return result.settled ? 'Settled ' + result.settled + ' payment.' : 'Nothing in flight.';
      });
    }

    if (action === 'miss') {
      return window.MoMo.post('/demo/plans/' + planId + '/miss').then(function (plan) {
        return 'Missed. Now ' + plan.status + ', ' + plan.missedCount + ' missed in total.';
      });
    }

    // Post the callback MoMo would have posted. Works for any reference, including
    // one this process never requested — which is why it settles the seeded plan.
    return window.MoMo.get('/plans/' + planId).then(function (view) {
      var pending = view.payments.filter(function (payment) {
        return payment.status === 'pending';
      })[0];

      if (!pending) return 'Nothing awaiting confirmation.';

      return window.MoMo
        .postWebhook('/webhooks/momo/collection/' + pending.momoReference, {
          status: 'SUCCESSFUL',
          financialTransactionId: 'PRESENTER-' + Date.now(),
        })
        .then(function () {
          return 'Confirmed ' + window.MoMo.money(pending.amountCents) + '.';
        });
    });
  }

  function card(title, value) {
    return (
      '<div class="panel"><h3>' +
      window.MoMo.esc(title) +
      '</h3><p class="value">' +
      window.MoMo.esc(value) +
      '</p></div>'
    );
  }
})();
