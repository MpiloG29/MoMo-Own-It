/**
 * The buyer's home: every plan on this number, and the record those payments
 * add up to.
 *
 * Plans carry an itemId rather than a title, so the item list is fetched once
 * and used as a lookup — cheaper than a request per plan, and a plan still
 * renders if its item has since been de-listed.
 */
(function () {
  var session = window.Session.requireSignedIn();
  if (!session) return;
  window.MoMo.mountSession(session);

  var MODE_LABEL = { reserve: 'Reserve', take_it_now: 'Take It Now' };

  var status = document.getElementById('home-status');
  var alertBox = document.getElementById('home-alert');
  var recordBox = document.getElementById('home-record');
  var plansBox = document.getElementById('home-plans');

  Promise.all([
    window.MoMo.get('/buyers/' + encodeURIComponent(session.msisdn) + '/plans'),
    window.MoMo.get('/records/' + encodeURIComponent(session.msisdn)),
    window.MoMo.get('/items').catch(function () {
      return [];
    }),
  ])
    .then(function (results) {
      render(results[0], results[1], results[2]);
    })
    .catch(function (error) {
      window.MoMo.show(status, '');
      window.MoMo.show(alertBox, error.message);
    });

  function render(plans, record, items) {
    var titles = {};
    items.forEach(function (item) {
      titles[item.id] = item.title;
    });

    recordBox.innerHTML =
      card('Plans running', String(record.plansActive), 'paid off: ' + record.plansCompleted) +
      card('Payments on time', String(record.paymentsOnTime), 'late: ' + record.paymentsLate) +
      card('On-time rate', Math.round(record.onTimeRate * 100) + '%', '<a href="/record">See your record</a>') +
      card('Repaid so far', window.MoMo.money(record.totalRepaidCents), 'across every plan');

    if (!plans.length) {
      plansBox.innerHTML =
        '<div class="panel notice"><h3>Nothing yet</h3>' +
        '<p>Pick something from the <a href="/shop">shop</a> and choose an instalment you can hold.</p></div>';
      window.MoMo.show(status, '');
      return;
    }

    plansBox.innerHTML = plans.map(function (plan) {
      return row(plan, titles[plan.itemId]);
    }).join('');

    window.MoMo.show(status, '');
  }

  function card(title, value, note) {
    return (
      '<div class="panel"><h3>' +
      window.MoMo.esc(title) +
      '</h3><p class="value">' +
      window.MoMo.esc(value) +
      '</p><p><small>' +
      note +
      '</small></p></div>'
    );
  }

  function row(plan, title) {
    var percent = plan.totalCents ? Math.round((plan.paidCents / plan.totalCents) * 100) : 0;

    return (
      '<a class="plan-row" href="/plan?id=' +
      encodeURIComponent(plan.id) +
      '">' +
      '<span class="plan-row-head">' +
      '<strong>' +
      window.MoMo.esc(title || 'Item no longer listed') +
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
      '</span>' +
      '<span class="progress"><span style="width:' +
      percent +
      '%"></span></span>' +
      '<span class="plan-row-foot">' +
      window.MoMo.money(plan.paidCents) +
      ' of ' +
      window.MoMo.money(plan.totalCents) +
      ' — ' +
      percent +
      '%' +
      (plan.nextDueAt
        ? ' · next ' + window.MoMo.when(plan.nextDueAt)
        : plan.completedAt
          ? ' · finished ' + window.MoMo.when(plan.completedAt)
          : '') +
      '</span>' +
      '</a>'
    );
  }
})();
