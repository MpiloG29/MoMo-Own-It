
(function () {
  var API = '/api/v1';

  var MODE_LABEL = { reserve: 'Reserve', take_it_now: 'Take It Now' };

  var session = window.Session.requireSignedIn();
  if (!session) return;

  var container = document.getElementById('items-container');
  var status = document.getElementById('items-status');
  var filters = document.getElementById('mode-filters');

  document.getElementById('session-msisdn').textContent = '+' + session.msisdn;
  document.getElementById('sign-out').addEventListener('click', function () {
    window.Session.end();
    window.location.replace('/');
  });

  var money = window.MoMo.money;
  var esc = window.MoMo.esc;

  function setStatus(message) {
    status.textContent = message || '';
    status.hidden = !message;
  }

  function itemCard(item) {
    var image = item.imageUrl
      ? '<img class="item-image" src="' +
        esc(item.imageUrl) +
        '" alt="' +
        esc(item.title) +
        '" loading="lazy" />'
      : '<div class="item-image is-empty" aria-hidden="true"></div>';

    return (
      '<article class="item">' +
      image +
      '<div class="item-body">' +
      '<span class="tag tag-' +
      esc(item.mode) +
      '">' +
      esc(MODE_LABEL[item.mode] || item.mode) +
      '</span>' +
      '<h3 class="item-title">' +
      esc(item.title) +
      '</h3>' +
      '<p class="item-price">' +
      money(item.priceCents) +
      '</p>' +
      '<p class="item-terms">From ' +
      money(item.minWeeklyCents) +
      ' a week, up to ' +
      item.maxWeeks +
      ' weeks</p>' +
      '<button class="btn btn-ghost item-toggle" type="button" aria-expanded="false" data-id="' +
      esc(item.id) +
      '">See payment plans</button>' +
      '<div class="item-plans" hidden></div>' +
      '</div>' +
      '</article>'
    );
  }

  /** Every plan the supplier's limits allow — the buyer's choice, priced by the API. */
  function planList(options) {
    if (!options.length) {
      return '<p class="item-note">No plan fits this supplier\u2019s limits.</p>';
    }

    return (
      '<ul class="plan-list">' +
      options
        .map(function (option) {
          // The last instalment absorbs the rounding, so the buyer never overpays.
          var tail =
            option.finalInstalmentCents !== option.weeklyAmountCents
              ? ' <span class="plan-final">last week ' +
                money(option.finalInstalmentCents) +
                '</span>'
              : '';
          return (
            '<li><strong>' +
            money(option.weeklyAmountCents) +
            '</strong> a week for ' +
            option.weeks +
            ' weeks' +
            tail +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function loadPlanOptions(itemId, panel) {
    panel.innerHTML = '<p class="item-note">Loading plans\u2026</p>';

    fetch(API + '/items/' + encodeURIComponent(itemId) + '/plan-options')
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        panel.innerHTML =
          planList(payload.options || []) +
          '<a class="btn btn-wide" href="/item?id=' +
          encodeURIComponent(itemId) +
          '">Choose an instalment</a>';
        panel.setAttribute('data-loaded', 'true');
      })
      .catch(function (error) {
        panel.innerHTML = '<p class="item-note is-error">Could not load plans.</p>';
        console.error('plan-options.failed', error);
      });
  }

  function loadItems(mode) {
    setStatus('Loading items\u2026');
    container.innerHTML = '';

    fetch(API + '/items' + (mode ? '?mode=' + encodeURIComponent(mode) : ''))
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (items) {
        if (!items.length) {
          setStatus('Nothing listed here yet.');
          return;
        }
        setStatus('');
        container.innerHTML = items.map(itemCard).join('');
      })
      .catch(function (error) {
        setStatus('Could not load items. Check that the server is running.');
        console.error('items.failed', error);
      });
  }

  container.addEventListener('click', function (event) {
    var toggle = event.target.closest('.item-toggle');
    if (!toggle) return;

    var panel = toggle.nextElementSibling;
    var opening = panel.hidden;

    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    toggle.textContent = opening ? 'Hide payment plans' : 'See payment plans';

    // Fetched once per item, then kept.
    if (opening && !panel.getAttribute('data-loaded')) {
      loadPlanOptions(toggle.getAttribute('data-id'), panel);
    }
  });

  filters.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;

    Array.prototype.forEach.call(filters.querySelectorAll('.chip'), function (each) {
      var selected = each === chip;
      each.classList.toggle('is-selected', selected);
      each.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    loadItems(chip.getAttribute('data-mode'));
  });

  loadItems('');
})();
