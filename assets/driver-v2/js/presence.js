/* Driver availability must be cleared while the authenticated session exists. */
(() => {
    const offline = () => ({
        isOnline: false,
        isBroadcasting: false,
        offlineAt: firebase.database.ServerValue.TIMESTAMP,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    });

    window.AsiyeDriverPresence = {
        driverId: null,
        connectionRef: null,
        connectionListener: null,
        disconnect: null,

        async prepare(driverId) {
            if (!firebase.auth().currentUser || !driverId) throw new Error('Sign in before going online.');
            this.disconnect = firebase.database().ref(`taxis/${driverId}`).onDisconnect();
            await this.disconnect.update(offline());
        },

        start(driverId) {
            this.stop();
            this.driverId = driverId;
            this.connectionRef = firebase.database().ref('.info/connected');
            this.connectionListener = this.connectionRef.on('value', snapshot => {
                if (snapshot.val() === true && !window.ASIYE_DRIVER?.state?.loggingOut) {
                    this.prepare(driverId).catch(error => console.warn('Driver disconnect protection:', error.message));
                }
            });
        },

        stop() {
            if (this.connectionRef && this.connectionListener) this.connectionRef.off('value', this.connectionListener);
            this.connectionRef = null;
            this.connectionListener = null;
        },

        async goOffline() {
            const app = window.ASIYE_DRIVER;
            if (app?.state) app.state.loggingOut = true;
            try {
                const user = firebase.auth().currentUser;
                const current = app?.state;
                const currentOwned = user && current?.driverId &&
                    (current.driverId === user.uid || current.driver?.authUid === user.uid || current.driver?.userUid === user.uid);
                // Prefer the verified profile in use; legacy accounts can have
                // another linked record. Never trust a localStorage ID alone.
                const profile = currentOwned ? {id:current.driverId}
                    : user ? await window.AsiyeEnrollment.resolveDriverProfile(user) : null;
                if (profile) await firebase.database().ref(`taxis/${profile.id}`).update(offline());
                app?.requests?.stop?.();
                app?.location?.stop?.();
                window.AsiyeNativeBridge?.notify?.('stopLocationWatch');
                if (app?.state) {
                    if (app.state.driver) Object.assign(app.state.driver, {isOnline:false, isBroadcasting:false});
                    if (app.state.availability) Object.assign(app.state.availability, {isOnline:false, isBroadcasting:false});
                }
                this.stop();
                await this.disconnect?.cancel?.().catch(() => {});
            } catch (error) {
                if (app?.state) app.state.loggingOut = false;
                throw error;
            }
        }
    };
})();
