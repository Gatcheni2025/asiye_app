document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const app = window.ASIYE_DRIVER || window.ASIYE;
            window.AsiyeTripChat?.close();
            window.AsiyePages?.dialog?.close();
            app.location?.stop?.();
            app.trip?.stop?.();
            app.ride?.stop?.();
            await firebase.auth().signOut();
            ['driverId','userId','commuterId','authUid','userType','driverPhone','currentRequestId'].forEach(key => localStorage.removeItem(key));
            window.location.replace('./login.html');
        } catch {
            button.disabled = false;
            (window.ASIYE_DRIVER || window.ASIYE).ui.toast('Unable to log out. Please try again.');
        }
    }));
});
