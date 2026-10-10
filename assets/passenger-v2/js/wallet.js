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


/* ============================================================
   RIDE PAYMENT ORCHESTRATION
   Negotiated Go: no money is reserved until driver + passenger agree a fare.
   Cash: marks the agreed fare due after negotiation.
   Wallet: reserves the agreed fare after negotiation; Club reserves when full.
   Card: opens Paystack only after negotiation; funds remain held until completion.
   ============================================================ */

ASIYE.payments = {
    openingReference:
        null,

    _cardSafetyFinalizeActive:
        false,

    _negotiatedPaymentActive:
        false,

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
        } catch (error) {
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
            localStorage.setItem(
                'pendingTripCardPayment',
                JSON.stringify({
                    requestId,
                    reference:
                        result.reference
                })
            );

            this.openingReference =
                result.reference;

            window.AsiyePages
                ?.openExternalPayment?.(
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

    // Paystack may return to the app before its webhook is delivered. When
    // the WebView resumes, verify the saved wallet reference server-to-server
    // instead of expecting the user to reopen the Wallet panel manually.
    _walletCheckActive: false,
    async reconcileWalletTopup() {
        const reference = localStorage.getItem('pendingPaystackReference');
        if (!reference || this._walletCheckActive || !firebase.auth().currentUser) return null;
        this._walletCheckActive = true;
        try {
            const result = await this.post('verifyPaystackWalletTopup', { reference });
            if (result.status === 'complete') {
                localStorage.removeItem('pendingPaystackReference');
                await ASIYE.wallet.refresh();
                ASIYE.ui?.toast?.('Payment confirmed. Your Asiye Wallet has been updated.');
            }
            return result;
        } catch (error) {
            console.warn('Wallet payment reconciliation will retry after return:',error?.code||error?.message);
            return null; // Keep the reference for the next resume.
        } finally { this._walletCheckActive = false; }
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
                        verified.status
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
                        900 +
                        attempt *
                        450
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
                    'Card payment is still being confirmed.'
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
                'Paid ride could not be restored.'
            );
        }


        /*
         * ASIYE GO CARD:
         * payment success is the gate to safety sharing and dispatch.
         * Do not clear the pending payment marker until PIN generation,
         * live sharing and booking finalisation all succeed.
         */
        if (
            request.type ===
                'ehailing' &&
            request.rideType ===
                'go' &&
            String(
                request.paymentMethod ||
                ''
            ).toLowerCase() ===
                'card'
        ) {
            if (
                !ASIYE.booking ||
                typeof ASIYE.booking
                    .finalizePaidCardBooking !==
                    'function'
            ) {
                throw new Error(
                    'Paid ride safety finalisation is unavailable. Reopen Asiye and try again.'
                );
            }


            await ASIYE.booking
                .finalizePaidCardBooking(
                    pending.requestId,
                    request
                );


            localStorage.removeItem(
                'pendingTripCardPayment'
            );

            this.openingReference =
                null;

            return true;
        }


        localStorage.removeItem(
            'pendingTripCardPayment'
        );

        this.openingReference =
            null;


        if (
            request.type ===
                'club'
        ) {
            await ASIYE.ride
                ?.start?.(
                    pending.requestId
                );

            ASIYE.ui?.toast?.(
                'Card payment held. Your Club will move once all passenger payments are ready.'
            );

            return true;
        }


        /*
         * Parcel/card flows already complete their safety share before
         * checkout in build 329. Keep their existing dispatch behaviour.
         */
        if (
            request.status ===
                'pending' ||
            request.paymentStatus ===
                'held'
        ) {
            await ASIYE.booking
                ?.notifyGoDrivers?.(
                    pending.requestId,
                    request
                );

            await ASIYE.ride
                ?.start?.(
                    pending.requestId
                );

            ASIYE.ui?.toast?.(
                'Card payment confirmed. Looking for your driver.'
            );

            return true;
        }


        await ASIYE.ride
            ?.start?.(
                pending.requestId
            );

        return true;
    },

    async handleTripState(request) {
        if (
            !request ||
            !ASIYE.state?.userId
        ) {
            return;
        }

        let method =
            String(
                request.paymentMethod ||
                'cash'
            )
                .toLowerCase();

        let status =
            String(
                request.paymentStatus ||
                ''
            );

        if (
            request.type ===
                'club'
        ) {
            const passenger =
                request.passengers?.[
                    ASIYE.state.userId
                ];

            if (!passenger) {
                return;
            }

            method =
                String(
                    passenger.paymentMethod ||
                    request.paymentMethod ||
                    'cash'
                )
                    .toLowerCase();

            status =
                String(
                    passenger.paymentStatus ||
                    ''
                );

            if (
                method ===
                    'wallet' &&
                status ===
                    'wallet_insufficient'
            ) {
                ASIYE.ui?.toast?.(
                    'Your Club is full, but your Asiye Wallet needs more funds before a driver can be released.'
                );

                return;
            }

            if (
                request.poolReady !==
                    true
            ) {
                return;
            }
        }

        /*
         * If Paystack was already verified but the user did not finish the
         * loved-one share sheet (or the app restarted), resume the safety
         * finalisation instead of opening a second Paystack checkout.
         */
        if (
            request.type ===
                'ehailing' &&
            request.rideType ===
                'go' &&
            method ===
                'card' &&
            [
                'held',
                'captured'
            ].includes(
                status
            ) &&
            request.paymentsReady ===
                true &&
            request.safetyShareCompleted !==
                true
        ) {
            if (
                this._cardSafetyFinalizeActive
            ) {
                return;
            }

            this._cardSafetyFinalizeActive =
                true;

            try {
                await ASIYE.booking
                    ?.finalizePaidCardBooking?.(
                        request.requestId,
                        request
                    );

                const pending =
                    this.pendingCard();

                if (
                    pending?.requestId ===
                        request.requestId
                ) {
                    localStorage.removeItem(
                        'pendingTripCardPayment'
                    );

                    this.openingReference =
                        null;
                }
            } catch (error) {
                console.error(
                    'Paid card booking safety finalisation failed:',
                    error
                );

                ASIYE.ui?.toast?.(
                    error.message ||
                    'Payment is confirmed. Share the trip with a loved one to complete booking.'
                );
            } finally {
                this._cardSafetyFinalizeActive =
                    false;
            }

            return;
        }


        /*
         * NEGOTIATED ASIYE GO
         *
         * A driver is already reserved before this stage. Cash and Wallet
         * payment readiness is prepared only after the protected fare has
         * been agreed. Card falls through to the existing Paystack opener
         * below, also only after fare agreement.
         */
        const negotiatedGo =
            request.type ===
                'ehailing' &&
            request.rideType ===
                'go' &&
            request.negotiationEnabled ===
                true &&
            request.fareStatus ===
                'agreed' &&
            Boolean(
                request.taxiId
            );


        if (
            negotiatedGo &&
            request.status ===
                'payment_required' &&
            method !==
                'card'
        ) {

            if (
                this._negotiatedPaymentActive
            ) {
                return;
            }


            this._negotiatedPaymentActive =
                true;


            try {

                const result =
                    await this.prepare(
                        request.requestId
                    );


                if (
                    result?.ready ===
                        true
                ) {

                    await ASIYE.booking
                        ?.finalizeNegotiatedGoBooking?.(
                            request.requestId,
                            result,
                            {
                                ...request,
                                paymentStatus:
                                    result.status ||
                                    request.paymentStatus
                            }
                        );
                }


            } catch (error) {

                console.error(
                    'Negotiated Go payment preparation failed:',
                    error
                );


                ASIYE.ui?.toast?.(
                    error.message ||
                    (
                        method ===
                            'wallet'
                        ? 'Your Asiye Wallet could not reserve the agreed fare.'
                        : 'The agreed fare could not be prepared.'
                    )
                );


            } finally {

                this._negotiatedPaymentActive =
                    false;
            }


            return;
        }


        if (
            method !==
                'card' ||
            status !==
                'payment_required'
        ) {
            return;
        }

        const existing =
            this.pendingCard();

        if (
            existing?.requestId ===
                request.requestId
        ) {
            return;
        }

        try {
            await this.prepare(
                request.requestId
            );
        } catch (error) {
            console.error(
                'Ride card payment preparation failed:',
                error
            );

            ASIYE.ui?.toast?.(
                error.message ||
                'Unable to open card payment.'
            );
        }
    },

    async release(requestId) {
        if (!requestId) {
            return null;
        }

        const result =
            await this.post(
                'releaseTripPayment',
                {
                    requestId
                }
            );

        await ASIYE.wallet
            ?.refresh?.()
            .catch(
                () => {}
            );

        return result;
    }
};
