/* Drivers verify only their own bank; every status comes from the server. */
(async () => {
'use strict';
const byId = id => document.getElementById(id);
const state = byId('payoutStatus'), form = byId('payoutForm');
const base = 'https://us-central1-asiye-80386.cloudfunctions.net/configureDriverCardPayout';
let busy = false, driverId, user;
function message(status, heading, detail) {
    const badges = {verified:'Verified',not_configured:'Action needed',
        pending_paystack_verification:'Pending verification',provisioning:'Processing',
        manual_review:'Support needed',error:'Unable to verify',checking:'Checking'};
    byId('payoutBadge').textContent = badges[status] || 'Pending';
    byId('payoutBadge').dataset.state = status;
    byId('payoutHeading').textContent = heading;
    state.textContent = detail;
}
function setBusy(value) {
    busy = value;
    byId('checkPayoutStatus').disabled = value;
    byId('verifyPayoutBank').disabled = value;
    form.setAttribute('aria-busy', String(value));
}
async function send(action, body) {
    const token = await user.getIdToken(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(base + '?driverId=' + encodeURIComponent(driverId) +
            (action ? '&action=' + encodeURIComponent(action) : ''), {
            method: body ? 'POST' : 'GET',
            headers: {Authorization:'Bearer ' + token,'Content-Type':'application/json'},
            signal: controller.signal,
            body: body ? JSON.stringify({driverId,...body}) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok !== true) {
            const error = Error(data.error || 'Bank verification is unavailable. Please retry.');
            error.status = response.status;
            throw error;
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw Error('The connection timed out. Check verification again before submitting again.');
        throw error;
    } finally { clearTimeout(timeout); }
}
function showAccount(info) {
    const account = byId('payoutAccount');
    account.hidden = !/^[0-9]{4}$/.test(info.accountLast4 || '');
    account.textContent = account.hidden ? '' :
        (info.bankName ? info.bankName + ' · ' : '') + 'Account ending ' + info.accountLast4;
}
async function loadStatus() {
    form.hidden = true;
    byId('payoutAccount').hidden = true;
    const info = await send('status');
    showAccount(info);
    if (info.status === 'verified') {
        message('verified','Your bank is verified',
            'Your banking setup is complete. Return to the dashboard and go online to receive bookings. Paystack will settle your 80% share of successful card fares directly to this account.');
        return;
    }
    if (info.status === 'not_configured') {
        const banks = await send('banks');
        const list = byId('payoutBank');
        list.replaceChildren(new Option('Choose your bank',''));
        (banks.banks || []).forEach(bank => list.add(new Option(bank.name,bank.code)));
        if (list.options.length < 2) throw Error('Supported banks could not load. Check verification again to retry.');
        message('not_configured','Add your banking details',
            'Verify your own bank account before you can receive any new bookings.');
        form.hidden = false;
        return;
    }
    if (info.status === 'pending_paystack_verification' || info.status === 'provisioning') {
        message(info.status,'Your bank verification is in progress',
            'New bookings stay paused while verification is pending. Tap Check verification again to see the latest status. You do not need to submit another application.');
        return;
    }
    message('manual_review','Your banking setup needs review',
        'Contact Asiye support for help with your existing bank application. Do not submit a second application.');
}
function showError(error) {
    if (/insufficient.*(balance|funds|credit)|(balance|funds|credit).*(insufficient|not enough)/i.test(String(error.message || ''))) {
        message('error','Asiye needs to restore bank verification',
            'Bank verification is temporarily unavailable because Asiye must fund its verification service. You do not need to deposit money into your bank account or pay a driver top-up. Contact Asiye support, then retry once service is restored.');
        return;
    }
    message('error', error.status === 403 ? 'Driver approval required' : 'Bank status could not be confirmed',
        error.message || 'Check your connection and try again.');
}
async function refresh() {
    if (busy) return;
    setBusy(true);
    message('checking','Checking your bank status…','Please wait.');
    try { await loadStatus(); } catch (error) { form.hidden = true; showError(error); }
    finally { setBusy(false); }
}
form.onsubmit = async event => {
    event.preventDefault();
    if (busy || form.hidden || !form.reportValidity()) return;
    setBusy(true);
    message('checking','Verifying your banking details…','Keep this page open while Paystack checks your details.');
    try {
        await send('', {
            bankCode:byId('payoutBank').value,
            accountName:byId('payoutName').value.trim(),
            accountNumber:byId('payoutNumber').value.trim(),
            accountType:byId('payoutType').value,
            documentType:byId('payoutDocType').value,
            documentNumber:byId('payoutDoc').value.trim()
        });
        byId('payoutNumber').value = '';
        byId('payoutDoc').value = '';
        form.hidden = true;
        await loadStatus();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
};
byId('checkPayoutStatus').onclick = refresh;
byId('logoutBank').onclick = async () => {
    try { await window.AsiyeSession.logout(); }
    catch (_) { message('error','Could not log out','Check your connection and try again.'); }
};
try {
    let stopAuth;
    user = firebase.auth().currentUser || await new Promise(resolve => {
        stopAuth = firebase.auth().onAuthStateChanged(resolve);
    });
    stopAuth?.();
    if (!user) { location.replace('./login.html'); return; }
    const profile = await window.AsiyeEnrollment.resolveDriverProfile(user);
    if (!profile?.id) throw Error('Your driver profile could not be found. Sign in with your approved driver account.');
    driverId = profile.id;
    await refresh();
} catch (error) {
    form.hidden = true;
    showError(error);
}
})();
