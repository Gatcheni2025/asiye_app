/* Shared JS <-> Flutter bridge for native contact picking and camera scans. */
window.AsiyeNativeBridge = {
    _pending: new Map(),
    _sequence: 0,

    _channel() {
        if (window.Asiye && typeof window.Asiye.postMessage === 'function') {
            return window.Asiye;
        }

        if (window.Android && typeof window.Android.postMessage === 'function') {
            return window.Android;
        }

        return null;
    },

    request(action, payload = {}) {
        return new Promise((resolve, reject) => {
            const channel = this._channel();

            if (!channel) {
                reject(new Error('This feature is available in the Asiye mobile app.'));
                return;
            }

            const callbackId =
                `asiye_${Date.now()}_${++this._sequence}`;

            const timer = setTimeout(() => {
                this._pending.delete(callbackId);
                reject(new Error('The phone did not respond. Please try again.'));
            }, 120000);

            this._pending.set(callbackId, {
                resolve,
                reject,
                timer
            });

            try {
                channel.postMessage(
                    JSON.stringify({
                        action,
                        callbackId,
                        ...payload
                    })
                );
            } catch (error) {
                clearTimeout(timer);
                this._pending.delete(callbackId);
                reject(error);
            }
        });
    },

    _finish(payload) {
        const callbackId = payload?.callbackId;

        if (!callbackId) return;

        const pending = this._pending.get(callbackId);

        if (!pending) return;

        clearTimeout(pending.timer);
        this._pending.delete(callbackId);

        if (payload.cancelled === true) {
            pending.resolve(null);
            return;
        }

        if (payload.ok === false) {
            pending.reject(
                new Error(
                    payload.error ||
                    'The requested phone action could not be completed.'
                )
            );
            return;
        }

        pending.resolve(payload.result ?? null);
    },

    pickContact() {
        return this.request('pickContact');
    },

    scanImage({
        purpose = 'image',
        facing = 'rear'
    } = {}) {
        return this.request('scanImage', {
            purpose,
            facing
        });
    }
};

window.onAsiyeBridgeResult = payload => {
    window.AsiyeNativeBridge?._finish(payload);
};
