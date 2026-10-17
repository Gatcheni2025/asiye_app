window.AsiyeSession = {
    async logout() {
        const app = window.ASIYE_DRIVER || window.ASIYE || {};
        if (window.ASIYE_DRIVER) await window.AsiyeDriverPresence.goOffline();
        window.AsiyeTripChat?.close();
        window.AsiyePages?.dialog?.close();
        app.location?.stop?.();
        app.requests?.stop?.();
        app.trip?.stop?.();
        app.ride?.stop?.();
        await firebase.auth().signOut();
        ['driverId','userId','commuterId','authUid','userType','driverPhone','driverName','currentRequestId'].forEach(key => localStorage.removeItem(key));
        window.location.replace('./login.html');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            await window.AsiyeSession.logout();
        } catch {
            button.disabled = false;
            (window.ASIYE_DRIVER || window.ASIYE)?.ui?.toast?.('Unable to confirm you are offline. Check your connection and try logging out again.');
        }
    }));
});
