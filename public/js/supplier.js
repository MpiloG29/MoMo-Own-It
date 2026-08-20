/**
 * The supplier side. No login exists in this build — identity is the supplier
 * you pick — so this is a console, not an account.
 *
 * `GET /suppliers/:id/plans` answers the only three questions a supplier has:
 * what did I list, who is paying it off, and did my money arrive.
 */
(function () {
  var MODE_LABEL = { reserve: 'Reserve', use_it: 'Use It' };

  var picker = document.getElementById('supplier-picker');
  var status = document.getElementById('supplier-status');
  var alertBox = document.getElementById('supplier-alert');
  var view = document.getElementById('supplier-view');

  var current = null;

  window.MoMo
    .get('/suppliers')
    .then(function (suppliers) {
      if (!suppliers.length) {
        window.MoMo.show(status, 'No suppliers yet. Run "npm run seed".');
        return;
      }

      picker.innerHTML = suppliers
        .map(function (supplier) {
          return (
            '<option value="' +
            window.MoMo.esc(supplier.id) +
            '">' +
            window.MoMo.esc(supplier.name) +
            ' (+' +
            window.MoMo.esc(supplier.msisdn) +
            ')</option>'
          );
        })
        .join('');

      picker.addEventListener('change', function () {
        loadSupplier(picker.value);
      });

      document.getElementById('list-item').addEventListener('click', listItem);
      loadSupplier(suppliers[0].id);
    })
    .catch(fail);

  function loadSupplier(id) {
    current = id;
    window.MoMo.show(status, 'Loading…');

    window.MoMo
      .get('/suppliers/' + encodeURIComponent(id) + '/plans')
      .then(render)
      .catch(fail);
  }

  function render(data) {
    var owed = data.disbursements
      .filter(function (payout) {
        return payout.status === 'pending';
      })
      .reduce(function (total, payout) {
        return total + payout.amountCents;
      }, 0);

    var collected = data.plans.reduce(function (total, plan) {
      return total + plan.paidCents;
    }, 0);

    document.getElementById('supplier-summary').innerHTML =
      card('Listings', String(data.items.length), 'active items') +
      card('Plans running', String(activeCount(data.plans)), 'of ' + data.plans.length + ' ever') +
      card('Collected from buyers', window.MoMo.money(collected), 'across every plan') +
      card('Payouts awaiting', window.MoMo.money(owed), 'settled: ' + settledCount(data.disbursements));

    document.getElementById('supplier-plans').innerHTML = data.plans.length
      ? table(
          ['Buyer', 'Mode', 'Status', 'Paid', 'Next due'],
          data.plans.map(function (plan) {
            return [
              '<a href="/plan?id=' + encodeURIComponent(plan.id) + '">+' + window.MoMo.esc(plan.buyerMsisdn) + '</a>',
              window.MoMo.esc(MODE_LABEL[plan.mode] || plan.mode),
              pill(plan.status),
              window.MoMo.money(plan.paidCents) + ' of ' + window.MoMo.money(plan.totalCents),
              plan.nextDueAt ? window.MoMo.when(plan.nextDueAt) : '—',
            ];
          }),
        )
      : '<p class="item-note">No plans against your stock yet.</p>';

    document.getElementById('supplier-payouts').innerHTML = data.disbursements.length
      ? table(
          ['Raised', 'Amount', 'Status', 'Settled'],
          data.disbursements.map(function (payout) {
            return [
              window.MoMo.when(payout.createdAt),
              window.MoMo.money(payout.amountCents),
              pill(payout.status),
              payout.settledAt ? window.MoMo.when(payout.settledAt) : '—',
            ];
          }),
        )
      : '<p class="item-note">No payouts raised yet. Reserve pays out when a plan completes.</p>';

    document.getElementById('supplier-items').innerHTML = table(
      ['Item', 'Mode', 'Price', 'Your limits'],
      data.items.map(function (item) {
        return [
          '<a href="/item?id=' + encodeURIComponent(item.id) + '">' + window.MoMo.esc(item.title) + '</a>',
          window.MoMo.esc(MODE_LABEL[item.mode] || item.mode),
          window.MoMo.money(item.priceCents),
          'from ' + window.MoMo.money(item.minWeeklyCents) + ' a week, max ' + item.maxWeeks + ' weeks',
        ];
      }),
    );

    window.MoMo.show(status, '');
    view.hidden = false;
  }

  function listItem() {
    var button = document.getElementById('list-item');
    var note = document.getElementById('new-item-status');
    var image = document.getElementById('new-image').value.trim();

    var body = {
      supplierId: current,
      title: document.getElementById('new-title').value.trim(),
      priceCents: window.MoMo.toCents(document.getElementById('new-price').value),
      mode: document.getElementById('new-mode').value,
      minWeeklyCents: window.MoMo.toCents(document.getElementById('new-min').value),
      maxWeeks: Number(document.getElementById('new-weeks').value),
    };
    if (image) body.imageUrl = image;

    window.MoMo.show(alertBox, '');
    button.disabled = true;
    button.textContent = 'Listing…';

    window.MoMo
      .post('/items', body)
      .then(function (item) {
        note.hidden = false;
        note.textContent = '"' + item.title + '" is live in the shop.';
        ['new-title', 'new-price', 'new-min', 'new-weeks', 'new-image'].forEach(function (id) {
          document.getElementById(id).value = '';
        });
        loadSupplier(current);
      })
      .catch(function (error) {
        // 422s from the API name the field that was wrong; show that, not a generic failure.
        window.MoMo.show(alertBox, error.message);
      })
      .then(function () {
        button.disabled = false;
        button.textContent = 'List it';
      });
  }

  function activeCount(plans) {
    return plans.filter(function (plan) {
      return plan.status === 'active' || plan.status === 'behind';
    }).length;
  }

  function settledCount(payouts) {
    return payouts.filter(function (payout) {
      return payout.status === 'successful';
    }).length;
  }

  function pill(value) {
    return '<span class="pill pill-' + window.MoMo.esc(value) + '">' + window.MoMo.esc(value) + '</span>';
  }

  function card(title, value, note) {
    return (
      '<div class="panel"><h3>' +
      window.MoMo.esc(title) +
      '</h3><p class="value">' +
      value +
      '</p><p><small>' +
      window.MoMo.esc(note) +
      '</small></p></div>'
    );
  }

  function table(headings, rows) {
    return (
      '<table class="ledger"><thead><tr>' +
      headings
        .map(function (heading) {
          return '<th>' + window.MoMo.esc(heading) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows
        .map(function (cells) {
          return (
            '<tr>' +
            cells
              .map(function (cell) {
                return '<td>' + cell + '</td>';
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table>'
    );
  }

  function fail(error) {
    window.MoMo.show(status, '');
    window.MoMo.show(alertBox, error.message);
  }
})();
