/**
 * The device, simulated.
 *
 * `POST /demo/unlock/verify` runs the exact check the ESP32 runs, which is why
 * it is worth exposing over HTTP: firmware and backend are tested against the
 * same vectors. The one piece of device state — the last counter it accepted —
 * lives in localStorage here, because on real hardware it lives in flash and
 * never leaves.
 */
(function () {
  var DIGITS = 9;
  var STORE = 'momo.device.';

  var screen = document.getElementById('keypad-screen');
  var picker = document.getElementById('device-plan');
  var alertBox = document.getElementById('device-alert');
  var result = document.getElementById('device-result');
  var sequenceLabel = document.getElementById('device-sequence');

  var entry = '';

  var preselected = new URLSearchParams(window.location.search).get('plan');

  // Every Use It plan is a device. Reserve plans have no lock, so they are left out.
  window.MoMo
    .get('/items?mode=use_it')
    .then(function (items) {
      var suppliers = items
        .map(function (item) {
          return item.supplierId;
        })
        .filter(function (id, index, all) {
          return all.indexOf(id) === index;
        });

      return Promise.all(
        suppliers.map(function (id) {
          return window.MoMo.get('/suppliers/' + encodeURIComponent(id) + '/plans');
        }),
      );
    })
    .then(function (dashboards) {
      var seen = {};
      var plans = [];

      dashboards.forEach(function (dashboard) {
        var titles = {};
        dashboard.items.forEach(function (item) {
          titles[item.id] = item.title;
        });

        dashboard.plans.forEach(function (plan) {
          if (plan.mode !== 'use_it' || seen[plan.id]) return;
          seen[plan.id] = true;
          plans.push({ id: plan.id, label: (titles[plan.itemId] || 'Device') + ' — +' + plan.buyerMsisdn });
        });
      });

      if (!plans.length) {
        window.MoMo.show(alertBox, 'No Use It plans exist yet. Run "npm run seed" or start one in the shop.');
        return;
      }

      picker.innerHTML = plans
        .map(function (plan) {
          return (
            '<option value="' +
            window.MoMo.esc(plan.id) +
            '"' +
            (plan.id === preselected ? ' selected' : '') +
            '>' +
            window.MoMo.esc(plan.label) +
            '</option>'
          );
        })
        .join('');

      picker.addEventListener('change', showSequence);
      showSequence();
    })
    .catch(function (error) {
      window.MoMo.show(alertBox, error.message);
    });

  document.getElementById('keypad').addEventListener('click', function (event) {
    var key = event.target.closest('.key');
    if (!key) return;
    press(key.getAttribute('data-key'));
  });

  document.addEventListener('keydown', function (event) {
    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === 'Enter') press('enter');
    else if (event.key === 'Backspace') press('clear');
  });

  document.getElementById('device-reset').addEventListener('click', function () {
    window.localStorage.removeItem(STORE + picker.value);
    showSequence();
    setResult('', 'Device reset', 'It will accept any code from counter 1 again.');
  });

  function press(key) {
    if (key === 'clear') entry = '';
    else if (key === 'enter') return submit();
    else if (entry.length < DIGITS) entry += key;

    draw();
  }

  function draw() {
    screen.textContent = entry + '·'.repeat(Math.max(0, DIGITS - entry.length));
  }

  function sequenceFor(planId) {
    return Number(window.localStorage.getItem(STORE + planId) || 0);
  }

  function showSequence() {
    sequenceLabel.textContent = String(sequenceFor(picker.value));
    entry = '';
    draw();
  }

  function submit() {
    if (entry.length < 6) {
      setResult('is-bad', 'Too short', 'Unlock codes are ' + DIGITS + ' digits.');
      return;
    }

    var planId = picker.value;
    window.MoMo.show(alertBox, '');

    window.MoMo
      .post('/demo/unlock/verify', {
        planId: planId,
        code: entry,
        lastAcceptedSequence: sequenceFor(planId),
      })
      .then(function (outcome) {
        if (!outcome.valid) {
          setResult(
            'is-bad',
            'Refused',
            'No code at a counter above ' +
              sequenceFor(planId) +
              ' matches. An old code stays refused — that is the replay guard.',
          );
          return;
        }

        // The device only moves its counter forward on a code it accepted.
        window.localStorage.setItem(STORE + planId, String(outcome.sequence));
        showSequence();

        setResult(
          'is-good',
          outcome.days === 0 ? 'Unlocked for good' : 'Unlocked for ' + outcome.days + ' days',
          outcome.days === 0
            ? 'Counter ' + outcome.sequence + '. The plan is paid off; this device stops asking.'
            : 'Counter ' + outcome.sequence + ' accepted. It will ask again when the time runs out.',
        );
      })
      .catch(function (error) {
        window.MoMo.show(alertBox, error.message);
      });
  }

  function setResult(tone, heading, detail) {
    result.className = 'panel notice ' + tone;
    result.innerHTML =
      '<h3>' + window.MoMo.esc(heading) + '</h3><p>' + window.MoMo.esc(detail) + '</p>';
  }

  draw();
})();
