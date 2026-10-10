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
            this.panel =
                existing;

            this.syncFromState();

            this.setVisible(
                ASIYE.state.booking
                    .rideType ===
                    'go'
            );

            return;
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
                        Make a protected offer
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
                Offer between
                <strong>
                    R${Number(
                        prices.goMinimumOffer ||
                        0
                    ).toFixed(0)}
                </strong>
                and
                <strong>
                    R${Number(
                        prices.goMaximumOffer ||
                        0
                    ).toFixed(0)}
                </strong>.
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

                <div>
                    <span>Driver receives</span>
                    <strong id="goFareDriverAmount">
                        R0.00
                    </strong>
                </div>

                <div>
                    <span>Asiye fee</span>
                    <strong id="goFareAsiyeAmount">
                        R0.00
                    </strong>
                </div>
            </div>

            <p class="go-fare-protection-note">
                The passenger offer cannot go below the protected
                driver earnings floor, and a driver counter cannot
                exceed the Asiye Go ceiling.
            </p>

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
                        .goSuggested ||
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


        const breakdown =
            ASIYE.pricing
                .goBreakdown(
                    safe,
                    this.prices
                );


        ASIYE.state.booking
            .goNegotiation
            .offer =
            safe;


        const passenger =
            document.getElementById(
                'goFarePassengerAmount'
            );

        const driver =
            document.getElementById(
                'goFareDriverAmount'
            );

        const asiye =
            document.getElementById(
                'goFareAsiyeAmount'
            );


        if (passenger) {
            passenger.textContent =
                `R${safe.toFixed(0)}`;
        }


        if (driver) {
            driver.textContent =
                `R${this.money(
                    breakdown
                        .driverReceives
                )}`;
        }


        if (asiye) {
            asiye.textContent =
                `R${this.money(
                    breakdown
                        .asiyeCommission
                )}`;
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
                ASIYE.state.booking
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
            throw new Error(
                payload.error ||
                'Fare negotiation could not be completed.'
            );
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
        requestId
    ) {

        return this.post(
            'acceptGoFareCounter',
            {
                requestId
            }
        );
    },


    keepPassengerOffer(
        requestId
    ) {

        return this.post(
            'declineGoFareCounter',
            {
                requestId
            }
        );
    }
};
