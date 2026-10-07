

/* ============================================================
   TRIP / PARCEL CARD PAYMENT ORCHESTRATION
   Card checkout uses Paystack. No driver dispatch and no PIN is
   created until Paystack has been verified server-side.
   ============================================================ */

ASIYE.payments = {
    openingReference:
        null,

    async post(
        endpoint,
        body = {}
    ) {
        const authUser =
            firebase.auth()
                .currentUser;

        if (!authUser) {
            throw new Error(
                'Please sign in again before continuing with payment.'
            );
        }

        const token =
            await authUser
                .getIdToken(
                    true
                );

        let response;

        try {
            response =
                await fetch(
                    `https://us-central1-asiye-80386.cloudfunctions.net/${endpoint}`,
                    {
                        method:
                            'POST',
                        headers: {
                            'Authorization':
                                `Bearer ${token}`,
                            'X-Firebase-Auth':
                                `Bearer ${token}`,
                            'Content-Type':
                                'application/json'
                        },
                        body:
                            JSON.stringify(
                                body
                            )
                    }
                );
        } catch (_) {
            throw new Error(
                'Unable to reach Asiye payments. Check your connection and try again.'
            );
        }

        const payload =
            await response
                .json()
                .catch(
                    () => ({})
                );

        if (!response.ok) {
            throw new Error(
                payload.error ||
                'Payment could not be prepared.'
            );
        }

        return payload;
    },

    openCheckout(url) {
        const target =
            String(
                url ||
                ''
            ).trim();

        if (!/^https:\/\//i.test(target)) {
            throw new Error(
                'Paystack did not return a valid payment link.'
            );
        }

        try {
            if (
                window.AndroidNav &&
                typeof window.AndroidNav.postMessage ===
                    'function'
            ) {
                window.AndroidNav.postMessage(
                    JSON.stringify({
                        action:
                            'external_nav',
                        url:
                            target
                    })
                );

                return;
            }
        } catch (_) {
            // Fall through to browser checkout.
        }

        const opened =
            window.open(
                target,
                '_blank',
                'noopener,noreferrer'
            );

        if (!opened) {
            window.location.href =
                target;
        }
    },

    async prepare(requestId) {
        const result =
            await this.post(
                'prepareTripPayment',
                {
                    requestId
                }
            );

        if (
            result.method ===
                'wallet' &&
            result.ready ===
                true
        ) {
            await ASIYE.wallet
                ?.refresh?.()
                .catch(
                    () => {}
                );
        }

        if (
            result.method ===
                'card' &&
            result.authorizationUrl &&
            result.reference
        ) {
            const pending = {
                requestId,
                reference:
                    result.reference,
                createdAt:
                    Date.now()
            };

            localStorage.setItem(
                'pendingTripCardPayment',
                JSON.stringify(
                    pending
                )
            );

            this.openingReference =
                result.reference;

            this.openCheckout(
                result.authorizationUrl
            );

            return {
                ...result,
                paymentPending:
                    true
            };
        }

        return result;
    },

    pendingCard() {
        try {
            return JSON.parse(
                localStorage.getItem(
                    'pendingTripCardPayment'
                ) ||
                'null'
            );
        } catch (_) {
            return null;
        }
    },

    async resumePendingCard() {
        const pending =
            this.pendingCard();

        if (
            !pending?.requestId ||
            !pending?.reference
        ) {
            return false;
        }

        return await this
            .handleCardReturn(
                pending.reference
            );
    },

    clubPrepareInFlight:
        new Set(),

    async handleTripState(
        request
    ) {
        if (
            !request ||
            request.type !==
                'club' ||
            request.poolReady !==
                true
        ) {
            return false;
        }

        const passengerId =
            String(
                ASIYE.state.userId ||
                ''
            );

        const passenger =
            request.passengers?.[
                passengerId
            ];

        if (!passenger) {
            return false;
        }

        const method =
            String(
                passenger.paymentMethod ||
                request.paymentMethod ||
                'cash'
            )
            .toLowerCase();

        const status =
            String(
                passenger.paymentStatus ||
                ''
            );

        if (
            method !==
                'card'
        ) {
            if (
                status ===
                    'wallet_insufficient'
            ) {
                ASIYE.ui?.toast?.(
                    'Your Club is full, but your Asiye Wallet needs more funds before collection can start.'
                );
            }

            return false;
        }

        if (
            [
                'held',
                'captured'
            ].includes(
                status
            )
        ) {
            const hasPin =
                /^\d{4}$/.test(
                    String(
                        passenger.pickupPin ||
                        ''
                    )
                );

            if (
                !hasPin ||
                passenger.safetyShareCompleted !==
                    true
            ) {
                await ASIYE.club
                    ?.finalizePaidPassenger?.(
                        request.requestId ||
                        ASIYE.state.booking
                            .requestId
                    );
            }

            return true;
        }

        if (
            status !==
                'payment_required'
        ) {
            return false;
        }

        const requestId =
            String(
                request.requestId ||
                ASIYE.state.booking
                    .requestId ||
                ''
            );

        if (!requestId) {
            return false;
        }

        const pending =
            this.pendingCard();

        if (
            pending?.requestId ===
                requestId
        ) {
            return true;
        }

        if (
            this.clubPrepareInFlight
                .has(
                    requestId
                )
        ) {
            return true;
        }

        this.clubPrepareInFlight
            .add(
                requestId
            );

        try {
            const result =
                await this.prepare(
                    requestId
                );

            if (
                result?.paymentPending ===
                    true
            ) {
                ASIYE.ui?.toast?.(
                    'Your Club is full. Complete your Paystack card payment to create your pickup PIN.'
                );
            }

            return true;

        } finally {
            this.clubPrepareInFlight
                .delete(
                    requestId
                );
        }
    },


    async handleCardReturn(reference) {
        const pending =
            this.pendingCard();

        if (
            !pending?.requestId ||
            !pending?.reference
        ) {
            return false;
        }

        const returned =
            String(
                reference ||
                ''
            ).trim();

        if (
            returned &&
            returned !==
                pending.reference
        ) {
            return false;
        }

        let verified =
            null;

        let lastError =
            null;

        for (
            let attempt = 0;
            attempt < 7;
            attempt += 1
        ) {
            try {
                verified =
                    await this.post(
                        'verifyTripCardPayment',
                        {
                            requestId:
                                pending.requestId,
                            reference:
                                pending.reference
                        }
                    );

                if (
                    verified.ready ===
                        true &&
                    [
                        'held',
                        'captured'
                    ].includes(
                        String(
                            verified.status ||
                            ''
                        )
                    )
                ) {
                    break;
                }

            } catch (error) {
                lastError =
                    error;
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        700 +
                        attempt *
                        350
                    )
            );
        }

        if (
            !verified ||
            verified.ready !==
                true
        ) {
            throw (
                lastError ||
                new Error(
                    'Card payment is still being confirmed by Paystack.'
                )
            );
        }

        const requestSnapshot =
            await firebase
                .database()
                .ref(
                    `requests/${pending.requestId}`
                )
                .once(
                    'value'
                );

        const request =
            requestSnapshot.val();

        if (!request) {
            throw new Error(
                'Paid booking could not be restored.'
            );
        }

        if (
            request.type ===
                'club'
        ) {
            if (
                !ASIYE.club ||
                typeof ASIYE.club
                    .finalizePaidPassenger !==
                    'function'
            ) {
                throw new Error(
                    'Club payment was confirmed, but the pickup PIN could not be finalized. Reopen Asiye and try again.'
                );
            }

            await ASIYE.club
                .finalizePaidPassenger(
                    pending.requestId
                );

            localStorage.removeItem(
                'pendingTripCardPayment'
            );

            this.openingReference =
                null;

            await ASIYE.ride
                ?.start?.(
                    pending.requestId
                );

            return true;
        }

        const isParcel =
            request.type ===
                'delivery' ||
            request.rideType ===
                'delivery';

        if (isParcel) {
            if (
                !ASIYE.parcels ||
                typeof ASIYE.parcels
                    .finalizePaidRequest !==
                    'function'
            ) {
                throw new Error(
                    'Parcel payment was confirmed, but the delivery could not be finalized. Reopen Asiye and try again.'
                );
            }

            await ASIYE.parcels
                .finalizePaidRequest(
                    pending.requestId
                );
        } else {
            if (
                !ASIYE.booking ||
                typeof ASIYE.booking
                    .finalizePaidRequest !==
                    'function'
            ) {
                throw new Error(
                    'Card payment was confirmed, but the ride could not be finalized. Reopen Asiye and try again.'
                );
            }

            await ASIYE.booking
                .finalizePaidRequest(
                    pending.requestId
                );
        }

        localStorage.removeItem(
            'pendingTripCardPayment'
        );

        this.openingReference =
            null;

        return true;
    }
};


window.onAsiyePaymentReturn =
    async payload => {
        const reference =
            typeof payload ===
                'string'
                ? payload
                : payload?.reference;

        try {
            await ASIYE.payments
                .handleCardReturn(
                    reference
                );
        } catch (error) {
            console.error(
                'Paystack return handling failed:',
                error
            );

            ASIYE.ui?.toast?.(
                error?.message ||
                'Payment is still being confirmed.'
            );
        }
    };
