/* Flutter push callbacks for both V2 WebView apps. */
window.onPushNotificationReceived = function(data) {
    const app = window.ASIYE_DRIVER || window.ASIYE;
    app?.ui?.toast(data.title || data.message || data.body || 'New Asiye update');
};
window.onNotificationClicked = async function(data) {
    const app = window.ASIYE_DRIVER || window.ASIYE;

    if (data?.type === 'app_update') {
        const channel = window.Asiye || window.Android;
        if (channel && typeof channel.postMessage === 'function') {
            channel.postMessage(JSON.stringify({
                action: 'openAppUpdate',
                ...data
            }));
        } else {
            app?.ui?.toast('A new Asiye update is available.');
        }
        return;
    }

    const id = data.requestId || data.tripId;
    if (!id) { window.onPushNotificationReceived(data); return; }
    if (!app?.state || !(app.state.driverId || app.state.userId)) {
        sessionStorage.setItem('pendingTripNotification', JSON.stringify(data));
        return;
    }
    try {
        if (!/^[^.#$\[\]/]+$/.test(id)) return;
        const snap = await firebase.database().ref(`requests/${id}`).once('value');
        const request = snap.val();
        const uid = app.state.driverId || app.state.userId;
        const belongs = window.ASIYE_DRIVER
            ? request && (request.taxiId === uid || request.driverId === uid)
            : request && (request.commuterId === uid || request.passengers?.[uid]);
        if (!belongs) { app.ui.toast('This trip is not available for your account.'); return; }
        await (app.trip || app.ride).start(id);
        sessionStorage.removeItem('pendingTripNotification');
    } catch { app.ui.toast('Unable to open the trip. Check your connection.'); }
};
document.addEventListener('DOMContentLoaded', () => {
    // Login/profile restoration is asynchronous. Wait for it before syncing the token.
    const timer = setInterval(() => {
        const app = window.ASIYE_DRIVER || window.ASIYE;
        const uid = app?.state?.driverId || app?.state?.userId;
        if (!uid || !window.firebase?.apps?.length) return;
        clearInterval(timer);
        const token = localStorage.getItem('fcmToken');
        if (token) firebase.database().ref(`${window.ASIYE_DRIVER ? 'taxis' : 'commuters'}/${uid}`).update({ fcmToken: token }).catch(error => console.warn('Push registration failed', error.code));
        const pending = sessionStorage.getItem('pendingTripNotification');
        if (pending) { try { window.onNotificationClicked(JSON.parse(pending)); } catch { sessionStorage.removeItem('pendingTripNotification'); } }
    }, 500);
    window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
});
