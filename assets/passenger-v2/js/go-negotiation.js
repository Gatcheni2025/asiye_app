/* ============================================================
   ASIYE GO — PROTECTED FARE NEGOTIATION
   Passenger-side UI + secure server responses
   ============================================================ */

window.ASIYE =
    window.ASIYE || {};

ASIYE.goNegotiation = {

    prices:
        null,

    panel:
        null,

    mountedContainer:
        null,


    escape(value) {
        return String(
            value ?? ''
        )
            .replaceAll(
                '&',
                '&amp;'
            )
            .replaceAll(
                '<',
                '&lt;'
            )
            .replaceAll(
                '>',
                '&gt;'
            )
            .replaceAll(
                '"',
                '&quot;'
            )
            .replaceAll(
                "'",
                '&#039;'
            );
    },


    money(value) {
        const number =
            Number(
                value || 0
            );

        return Number.isFinite(
            number
        )
            ? number.toFixed(2)
            : '0.00';
    },


    mount(
        container,
        prices
    ) {

        if (
            !container ||
            !prices
        ) {
            return;
        }


        this.prices =
            prices;

        this.mountedContainer =
            container;


        const existing =
            document.getElementById(
                'goFareNegotiationPanel'
            );

        if (existing) {
            existing.remove();
        }


        const panel =
            document.createElement(
                'section'
            );

        panel.id =
            'goFareNegotiationPanel';

        panel.className =
            'go-fare-negotiation';


        panel.innerHTML = `
            <div class="go-fare-heading">
                <div>
                    <div class="home-kicker">
                        Asiye Go fare
                    </div>
                    <strong>
                        Make your fare offer
                    </strong>
                </div>

                <span>
                    Market ~R${Number(
                        prices.marketReference ||
                        0
                    ).toFixed(0)}
                </span>
            </div>

            <div class="go-fare-range-copy">
                Recommended:
                <strong>
                    R${Number(
                        prices.goSuggested ||
                        0
                    ).toFixed(0)}
                </strong>.
            </div>

            <div class="go-fare-input-row">
                <span>R</span>

                <input
                    id="goFareOfferInput"
                    type="number"
                    inputmode="decimal"
                    min="${Number(
                        prices.goMinimumOffer ||
                        0
                    ).toFixed(0)}"
                    max="${Number(
                        prices.goMaximumOffer ||
                        0
                    ).toFixed(0)}"
                    step="1"
                    aria-label="Your Asiye Go fare offer"
                >
            </div>

            <input
                id="goFareOfferSlider"
                class="go-fare-slider"
                type="range"
                min="${Number(
                    prices.goMinimumOffer ||
                    0
                ).toFixed(0)}"
                max="${Number(
                    prices.goMaximumOffer ||
                    0
                ).toFixed(0)}"
                step="1"
                aria-label="Adjust your Asiye Go fare offer"
            >

            <div class="go-fare-protection-grid">
                <div>
                    <span>You pay</span>
                    <strong id="goFarePassengerAmount">
                        R0
                    </strong>
                </div>

            </div>

            <p class="go-fare-protection-note">
                Offer from R${Number(prices.goMinimumOffer || 0).toFixed(0)}
                (65% of the route reference), up to
                R${Number(prices.goMaximumOffer || 0).toFixed(0)}.
                The driver decides whether to accept, decline or counter.
                No payment is taken until the fare is agreed.
            </p>

            <p id="goFareOfferGuidance" class="go-fare-protection-note" role="status"></p>

            <div
                id="goFareOfferError"
                class="go-fare-error"
            ></div>
        `;


        const payment =
            container.querySelector(
                '.asiye-payment-picker'
            );

        const confirm =
            document.getElementById(
                'confirmRideSelection'
            );


        if (
            payment &&
            payment.parentNode ===
                container
        ) {
            container.insertBefore(
                panel,
                payment
            );

        } else if (
            confirm &&
            confirm.parentNode ===
                container
        ) {
            container.insertBefore(
                panel,
                confirm
            );

        } else {
            container.appendChild(
                panel
            );
        }


        this.panel =
            panel;


        const input =
            document.getElementById(
                'goFareOfferInput'
            );

        const slider =
            document.getElementById(
                'goFareOfferSlider'
            );


        input?.addEventListener(
            'input',
            () => {
                this.applyOffer(
                    input.value,
                    false
                );
            }
        );


        input?.addEventListener(
            'change',
            () => {
                this.applyOffer(
                    input.value,
                    true
                );
            }
        );


        slider?.addEventListener(
            'input',
            () => {
                this.applyOffer(
                    slider.value,
                    true
                );
            }
        );


        this.syncFromState();


        this.setVisible(
            ASIYE.state.booking
                .rideType ===
                'go'
        );
    },


    syncFromState() {

        if (!this.prices) {
            return;
        }


        const existing =
            Number(
                ASIYE.state.booking
                    .goNegotiation
                    ?.offer
            );


        const preferred =
            Number.isFinite(
                existing
            )
                ? existing
                : Number(
                    this.prices
                        .goMinimumOffer ||
                    0
                );


        const offer =
            ASIYE.pricing
                .clampGoOffer(
                    preferred,
                    this.prices
                );


        ASIYE.state.booking
            .goNegotiation = {
                offer,

                minimum:
                    Number(
                        this.prices
                            .goMinimumOffer ||
                        0
                    ),

                maximum:
                    Number(
                        this.prices
                            .goMaximumOffer ||
                        0
                    ),

                suggested:
                    Number(
                        this.prices
                            .goSuggested ||
                        0
                    ),

                recommendedMinimum: Number(this.prices.goRecommendedMinimum || 1),

                marketReference:
                    Number(
                        this.prices
                            .marketReference ||
                        0
                    )
            };


        this.applyOffer(
            offer,
            true
        );

        // The same panel is reused when the route changes.
        for (const id of ['goFareOfferInput', 'goFareOfferSlider']) {
            const control = document.getElementById(id);
            if (control) {
                control.min = String(this.prices.goMinimumOffer);
                control.max = String(this.prices.goMaximumOffer);
                control.value = String(offer);
            }
        }
    },


    applyOffer(
        raw,
        clamp = true
    ) {

        if (!this.prices) {
            return null;
        }


        const minimum =
            Number(
                this.prices
                    .goMinimumOffer ||
                0
            );

        const maximum =
            Number(
                this.prices
                    .goMaximumOffer ||
                minimum
            );

        const parsed =
            Number(raw);


        const amount =
            clamp
                ? ASIYE.pricing
                    .clampGoOffer(
                        parsed,
                        this.prices
                    )
                : parsed;


        const input =
            document.getElementById(
                'goFareOfferInput'
            );

        const slider =
            document.getElementById(
                'goFareOfferSlider'
            );

        const error =
            document.getElementById(
                'goFareOfferError'
            );


        if (
            !Number.isFinite(
                amount
            ) ||
            amount <
                minimum ||
            amount >
                maximum
        ) {

            if (error) {
                error.textContent =
                    `Choose an offer between R${minimum.toFixed(0)} and R${maximum.toFixed(0)}.`;
            }


            return null;
        }


        const safe =
            Math.round(
                amount
            );


        if (input) {
            input.value =
                String(safe);
        }


        if (slider) {
            slider.value =
                String(safe);
        }


        if (error) {
            error.textContent =
                '';
        }

        const guidance = document.getElementById('goFareOfferGuidance');
        if (guidance) {
            guidance.textContent = safe < Number(this.prices.goRecommendedMinimum || 1)
                ? `Your R${safe} offer will be sent to drivers. A low offer may receive a counter-offer.`
                : 'Your offer will be sent to drivers for a decision.';
        }


        ASIYE.state.booking
            .goNegotiation
            .offer =
            safe;


        const passenger =
            document.getElementById(
                'goFarePassengerAmount'
            );

        if (passenger) {
            passenger.textContent =
                `R${safe.toFixed(0)}`;
        }


        return safe;
    },


    validate() {

        if (!this.prices) {
            this.prices =
                ASIYE.pricing
                    .calculate();
        }


        const offer =
            Number(
                document.getElementById('goFareOfferInput')?.value ?? ASIYE.state.booking
                    .goNegotiation
                    ?.offer
            );

        const minimum =
            Number(
                this.prices
                    .goMinimumOffer
            );

        const maximum =
            Number(
                this.prices
                    .goMaximumOffer
            );


        if (
            !Number.isFinite(
                offer
            ) ||
            offer <
                minimum ||
            offer >
                maximum
        ) {

            const message =
                `Choose an Asiye Go offer between R${minimum.toFixed(0)} and R${maximum.toFixed(0)}.`;

            const error =
                document.getElementById(
                    'goFareOfferError'
                );


            if (error) {
                error.textContent =
                    message;
            }


            throw new Error(
                message
            );
        }


        return Math.round(
            offer
        );
    },


    currentOffer() {

        return this.validate();
    },


    setVisible(visible) {

        if (!this.panel) {
            this.panel =
                document.getElementById(
                    'goFareNegotiationPanel'
                );
        }


        if (this.panel) {
            this.panel.style.display =
                visible
                    ? 'block'
                    : 'none';
        }
    },


    async post(
        endpoint,
        body
    ) {

        const user =
            firebase.auth()
                .currentUser;


        if (!user) {
            throw new Error(
                'Please sign in again before negotiating your fare.'
            );
        }


        const token =
            await user.getIdToken(
                true
            );


        const response =
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
                            body ||
                            {}
                        )
                }
            );


        const payload =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (!response.ok) {
            const error =
                new Error(
                    payload.error ||
                    'Fare negotiation could not be completed.'
                );

            error.status =
                response.status;

            error.code =
                payload.code ||
                '';

            error.activeRequestId =
                payload.activeRequestId ||
                '';

            error.activeStatus =
                payload.activeStatus ||
                '';

            error.payload =
                payload;

            throw error;
        }


        return payload;
    },


    submitOffer(
        requestId,
        amount
    ) {

        return this.post(
            'submitGoFareOffer',
            {
                requestId,
                amount
            }
        );
    },


    acceptDriverCounter(
        requestId,
        counter = {}
    ) {

        return this.post(
            'acceptGoFareCounter',
            {
                requestId,
                ...(counter.driverCounterFare != null ? {amount:Number(counter.driverCounterFare)} : {}),
                ...(counter.negotiationRound != null ? {negotiationRound:Number(counter.negotiationRound)} : {})
            }
        );
    },


    keepPassengerOffer(
        requestId,
        counter = {}
    ) {

        return this.post(
            'declineGoFareCounter',
            {
                requestId,
                ...(counter.driverCounterFare != null ? {amount:Number(counter.driverCounterFare)} : {}),
                ...(counter.negotiationRound != null ? {negotiationRound:Number(counter.negotiationRound)} : {})
            }
        );
    }
};
