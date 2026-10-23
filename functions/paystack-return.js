'use strict';

// A browser callback is navigation only. It never verifies or credits money.
function returnModel(projectId, value) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw Error('Invalid Firebase project.');
  const reference = typeof value === 'string' && /^[A-Za-z0-9.=\-]{1,100}$/.test(value) ? value : '';
  const encoded = encodeURIComponent(reference);
  return {
    reference,
    web: `https://${projectId}.web.app/passenger-v2/index.html?payment_return=1&reference=${encoded}`,
    native: `asiye://payment-complete?reference=${encoded}`,
    android: `intent://payment-complete?reference=${encoded}#Intent;scheme=asiye;package=com.asiyeapp.asiye;end`,
    // Existing installed candidates use production Firebase. Never send a
    // staging payment to those apps through the shared custom URL scheme.
    nativeAllowed: projectId === 'asiye-80386'
  };
}

function renderPaymentReturn(projectId, reference) {
  const model = returnModel(projectId, reference);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Return to Asiye</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f7f5;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;color:#14251c}
main{width:min(480px,100%);background:#fff;border-radius:26px;padding:32px;text-align:center;box-shadow:0 16px 60px #14251c12}
.mark{font-size:13px;font-weight:800;letter-spacing:.18em;color:#24794b}h1{font-size:27px;margin:20px 0 12px}p{color:#59685f;line-height:1.6}
a{display:block;padding:15px;margin-top:12px;border-radius:14px;background:#16643b;color:white;font-weight:700;text-decoration:none}#nativeReturn{background:#edf4ef;color:#16643b}[hidden]{display:none!important}.ref{font-size:12px;word-break:break-all}
</style></head><body><main>
<div class="mark">ASIYE</div><h1>Returning to your ride</h1>
<p>Asiye will verify your payment with Paystack before confirming pickup.</p>
<a id="webReturn" href="${model.web}">Continue to my ride</a>
<a id="nativeReturn" href="${model.native}" hidden>Open Asiye app</a>
<p class="ref" id="reference"></p>
<p id="returnMessage">If this page stays open, tap Continue to my ride.</p>
</main><script>
(() => {
  const model = ${JSON.stringify(model)};
  document.getElementById('reference').textContent = model.reference ? 'Reference: ' + model.reference : '';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const native = document.getElementById('nativeReturn');
  if (model.nativeAllowed && mobile) {
    const target = /Android/i.test(navigator.userAgent || '') ? model.android : model.native;
    native.hidden = false;
    native.href = target;
    document.getElementById('returnMessage').textContent = 'Open the Asiye app, or continue to your ride in this browser.';
    try { window.location.href = target; } catch (_) {}
    setTimeout(() => { if (!document.hidden) window.location.replace(model.web); }, 1800);
  } else {
    window.location.replace(model.web);
  }
})();
</script></body></html>`;
}

module.exports = {returnModel, renderPaymentReturn};
