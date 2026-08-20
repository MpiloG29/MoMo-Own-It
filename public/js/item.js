/**
 * The plan builder.
 *
 * Every instalment offered here comes from `GET /items/:id/plan-options`, which
 * applies the supplier's floor and ceiling and works out where the rounding
 * lands. The page never prices a plan itself — if it did, it could disagree with
 * the engine that collects the money.
 */
(function () {
  var session = window.Session.requireSignedIn();
  if (!session) return;
  window.MoMo.mountSession(session);

  var MODE_LABEL = { reserve: 'Reserve', use_it: 'Use It' };
  var POSSESSION_COPY = {
    reserve: 'Your supplier holds it until the last instalment clears.',
    use_it: 'It goes home with you on day one and stays on while payments land.',
  };

  var itemId = new URLSearchParams(window.location.search).get('id');

  var view = document.getElementById('item-view');
  var status = document.getElementById('item-status');
  var alertBox = document.getElementById('item-alert');
  var optionsBox = document.getElementById('item-options');
  var quote = document.getElementById('item-quote');
  var start = document.getElementById('start-plan');

  var chosen = null;

  if (!itemId) {
    window.MoMo.show(status, '');
    window.MoMo.show(alertBox, 'No item was chosen. Go back to the shop and pick one.');
    return;
  }

  window.MoMo.get('/items/' + encodeURIComponent(itemId) + '/plan-options')
    .then(render)
    .catch(function (error) {
      window.MoMo.show(status, '');
      window.MoMo.show(alertBox, error.message);
    });

  function render(payload) {
    var item = payload.item;
    var options = payload.options || [];

    document.title = item.title + ' — MoMo Own It';
    document.getElementById('item-title').textContent = item.title;
    document.getElementById('item-lede').textContent = POSSESSION_COPY[item.mode] || '';

    var image = document.getElementById('item-image');
    if (item.imageUrl) {
      image.src = item.imageUrl;
      image.alt = item.title;
      image.hidden = false;
    }

    document.getElementById('item-terms').innerHTML =
      '<h3>' +
      window.MoMo.esc(MODE_LABEL[item.mode] || item.mode) +
      '</h3>' +
      '<p class="value">' +
      window.MoMo.money(item.priceCents) +
      '</p>' +
      '<p><small>Total price. You pay it weekly, never more than it costs.</small></p>';

    document.getElementById('item-limits').textContent =
      'This supplier accepts from ' +
      window.MoMo.money(item.minWeeklyCents) +
      ' a week, over at most ' +
      item.maxWeeks +
      ' weeks.';

    if (!options.length) {
      window.MoMo.show(status, 'No plan fits this supplier’s limits.');
      return;
    }

    optionsBox.innerHTML = options.map(optionRow).join('');
    window.MoMo.show(status, '');
    view.hidden = false;

    optionsBox.addEventListener('click', function (event) {
      var button = event.target.closest('.option');
      if (!button) return;
      choose(options[Number(button.getAttribute('data-index'))], button);
    });

    start.addEventListener('click', submit);
  }

  function optionRow(option, index) {
    // The last instalment absorbs the rounding, so the buyer never overpays.
    var tail =
      option.finalInstalmentCents !== option.weeklyAmountCents
        ? '<span class="option-note">last week ' +
          window.MoMo.money(option.finalInstalmentCents) +
          '</span>'
        : '';

    return (
      '<button class="option" type="button" role="radio" aria-checked="false" data-index="' +
      index +
      '">' +
      '<span class="option-amount">' +
      window.MoMo.money(option.weeklyAmountCents) +
      '</span>' +
      '<span class="option-weeks">a week for ' +
      option.weeks +
      ' weeks</span>' +
      tail +
      '</button>'
    );
  }

  function choose(option, button) {
    chosen = option;

    Array.prototype.forEach.call(optionsBox.querySelectorAll('.option'), function (each) {
      var selected = each === button;
      each.classList.toggle('is-selected', selected);
      each.setAttribute('aria-checked', selected ? 'true' : 'false');
    });

    quote.innerHTML =
      '<strong>' +
      window.MoMo.money(option.weeklyAmountCents) +
      '</strong> a week for ' +
      option.weeks +
      ' weeks, ' +
      window.MoMo.money(option.totalCents) +
      ' in total. The first payment is today.';

    start.disabled = false;
  }

  function submit() {
    if (!chosen) return;

    window.MoMo.show(alertBox, '');
    start.disabled = true;
    start.textContent = 'Starting…';

    window.MoMo
      .post('/plans', {
        itemId: itemId,
        buyerMsisdn: session.msisdn,
        weeklyAmountCents: chosen.weeklyAmountCents,
      })
      .then(function (created) {
        // `await=1` tells the plan page that this collection is ours and it may
        // ask MoMo how it resolved.
        window.location.assign('/plan?id=' + encodeURIComponent(created.plan.id) + '&await=1');
      })
      .catch(function (error) {
        window.MoMo.show(alertBox, error.message);
        start.disabled = false;
        start.textContent = 'Start plan';
      });
  }
})();
