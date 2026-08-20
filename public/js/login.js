(function () {
  // Same rule the API applies to every MSISDN it accepts, in src/http/validation.ts.
  var MSISDN = /^\d{9,15}$/;
  var MIN_PASSWORD_LENGTH = 4;

  var form = document.getElementById('login-form');
  var submit = document.getElementById('submit');
  var alertBox = document.getElementById('form-alert');
  var msisdnInput = document.getElementById('msisdn');
  var passwordInput = document.getElementById('password');
  var msisdnError = document.getElementById('msisdn-error');
  var passwordError = document.getElementById('password-error');

  if (window.Session.current()) {
    window.location.replace('/dashboard');
    return;
  }

  function showFieldError(input, target, message) {
    target.textContent = message;
    target.classList.add('visible');
    input.setAttribute('aria-invalid', 'true');
  }

  function clearErrors() {
    [
      [msisdnInput, msisdnError],
      [passwordInput, passwordError],
    ].forEach(function (pair) {
      pair[1].textContent = '';
      pair[1].classList.remove('visible');
      pair[0].removeAttribute('aria-invalid');
    });
    alertBox.textContent = '';
    alertBox.classList.remove('visible');
  }

 
  function authenticate(msisdn, password) {
    if (!msisdn) return { field: msisdnInput, target: msisdnError, message: 'Enter your mobile number.' };
    if (!MSISDN.test(msisdn)) {
      return {
        field: msisdnInput,
        target: msisdnError,
        message: 'Use 9 to 15 digits, country code first and no plus sign.',
      };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        field: passwordInput,
        target: passwordError,
        message: 'Passwords are at least ' + MIN_PASSWORD_LENGTH + ' characters.',
      };
    }
    return null;
  }

  msisdnInput.addEventListener('input', function () {
    var digitsOnly = msisdnInput.value.replace(/\D/g, '');
    if (digitsOnly !== msisdnInput.value) msisdnInput.value = digitsOnly;
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearErrors();

    var msisdn = msisdnInput.value.trim();
    var failure = authenticate(msisdn, passwordInput.value);

    if (failure) {
      showFieldError(failure.field, failure.target, failure.message);
      failure.field.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Signing in…';

    
    window.setTimeout(function () {
      window.Session.start(msisdn);
      window.location.assign('/dashboard');
    }, 350);
  });
})();
