/* ============================================================
   ASIYE PASSENGER V2
   WALLET SYNCHRONIZATION + RIDE BALANCE GUARD
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.wallet = {
    ref: null,
    listener: null,
    passengerId: null,

    balance(user = ASIYE.state?.user || {}) {
        const value =
            user.walletBalance ??
            user.credits ??
            0;

        const amount =
            Number(value);

        return Number.isFinite(amount)
            ? Math.round(amount * 100) / 100
            : 0;
    },

    paint(balance = this.balance()) {
        const amount =
            Number.isFinite(Number(balance))
                ? Number(balance)
                : 0;

        document
            .querySelectorAll(
                '.wallet-amount, .member-page-wallet .member-balance strong'
            )
            .forEach(element => {
                element.textContent =
                    `R${amount.toFixed(2)}`;
            });
    },

    applyProfile(profile = {}) {
        ASIYE.state.user =
            ASIYE.state.user ||
            {};

        Object.assign(
            ASIYE.state.user,
            profile
        );

        const balance =
            this.balance(
                ASIYE.state.user
            );

        /*
         * Keep the legacy credits mirror aligned while older UI surfaces
         * still reference it. walletBalance remains the canonical value.
         */
        ASIYE.state.user.walletBalance =
            balance;

        ASIYE.state.user.credits =
            balance;

        this.paint(
            balance
        );

        ASIYE.profile
            ?.refreshUI?.(
                ASIYE.state.user
            );

        return balance;
    },

    stop() {
        if (
            this.ref &&
            this.listener
        ) {
            this.ref.off(
                'value',
                this.listener
            );
        }

        this.ref =
            null;

        this.listener =
            null;

        this.passengerId =
            null;
    },

    start(passengerId = ASIYE.state?.userId) {
        const id =
            String(
                passengerId ||
                ''
            ).trim();

        if (!id) {
            return;
        }

        if (
            this.passengerId === id &&
            this.ref &&
            this.listener
        ) {
            return;
        }

        this.stop();

        this.passengerId =
            id;

        this.ref =
            firebase
                .database()
                .ref(
                    `commuters/${id}`
                );

        this.listener =
            snapshot => {
                const profile =
                    snapshot.val();

                if (!profile) {
                    return;
                }

                this.applyProfile(
                    profile
                );
            };

        this.ref.on(
            'value',
            this.listener
        );
    },

    async refresh() {
        const id =
            String(
                ASIYE.state?.userId ||
                this.passengerId ||
                localStorage.getItem(
                    'commuterId'
                ) ||
                localStorage.getItem(
                    'userId'
                ) ||
                ''
            ).trim();

        if (!id) {
            throw new Error(
                'Passenger account is not loaded.'
            );
        }

        const snapshot =
            await firebase
                .database()
                .ref(
                    `commuters/${id}`
                )
                .once(
                    'value'
                );

        const profile =
            snapshot.val();

        if (!profile) {
            throw new Error(
                'Passenger wallet could not be loaded.'
            );
        }

        return this.applyProfile(
            profile
        );
    },

    async requireFare(
        fare,
        service = 'this ride'
    ) {
        const required =
            Math.max(
                0,
                Math.round(
                    Number(fare || 0) *
                    100
                ) / 100
            );

        if (
            !Number.isFinite(required) ||
            required <= 0
        ) {
            throw new Error(
                'The ride fare is unavailable. Please calculate the trip again.'
            );
        }

        const available =
            await this.refresh();

        if (
            available + 0.00001 <
            required
        ) {
            const shortfall =
                Math.max(
                    0,
                    Math.round(
                        (
                            required -
                            available
                        ) *
                        100
                    ) / 100
                );

            throw new Error(
                `Your Asiye Wallet has R${available.toFixed(2)}. ${service} requires R${required.toFixed(2)}. Add at least R${shortfall.toFixed(2)} before requesting the ride.`
            );
        }

        ASIYE.state.booking.paymentMethod =
            'wallet';

        return {
            available,
            required,
            remaining:
                Math.round(
                    (
                        available -
                        required
                    ) *
                    100
                ) / 100
        };
    }
};
