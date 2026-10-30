/* ============================================================
   ASIYE DRIVER V2 — PROTECTED GO FARE NEGOTIATION UI
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};

ASIYE_DRIVER.goNegotiation = {

    isProtectedGo(request) {
        return Boolean(
            request &&
            request.type !==
                'club' &&
            request.type !==
                'delivery' &&
            String(
                request.rideType ||
                'go'
            ) ===
                'go' &&
            request.negotiationEnabled ===
                true
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


    decorateIncomingRequest(
        request,
        content
    ) {

        if (
            !this.isProtectedGo(
                request
            ) ||
            !content ||
            request.fareStatus ===
                'agreed'
        ) {
            return;
        }


        const passengerOffer =
            Math.round(
                Number(
                    request.passengerOffer ||
                    request.finalAmount ||
                    request.calculatedPrice ||
                    0
                )
            );


        const maximum =
            Math.max(
                passengerOffer,
                Math.floor(
                    Number(
                        request.maximumFareOffer ||
                        passengerOffer
                    )
                )
            );


        const commissionRate =
            Number(
                request.commissionRate ||
                0.20
            );


        const asiyeCommission =
            Number(
                request.platformCommission ??
                (
                    passengerOffer *
                    commissionRate
                )
            );


        const driverReceives =
            Number(
                request.driverNetFare ??
                (
                    passengerOffer -
                    asiyeCommission
                )
            );


        const panel =
            document.createElement(
                'div'
            );


        panel.className =
            'driver-go-negotiation';


        const suggestedCounter =
            Math.min(
                maximum,
                Math.max(
                    passengerOffer,
                    Math.round(Number(request.suggestedFare || Number(request.marketReferenceFare || 0) * 0.90 || passengerOffer))
                )
            );

        const waiting = request.fareStatus === 'driver_counter';
        const canCounter = !waiting && passengerOffer < maximum;
        const recommendedMinimum = Number(request.recommendedMinimumFare || Number(request.marketReferenceFare || 0) * 0.65 || 1);
        const lowOffer = passengerOffer < recommendedMinimum;
        const counterNet = amount => this.money(Number(amount) * (1 - commissionRate));


        panel.innerHTML = `
            <div class="driver-go-negotiation-title">
                Passenger’s fare offer
            </div>

            <div class="driver-go-negotiation-summary">
                <div>
                    <span>Passenger offer</span>
                    <strong>
                        R${passengerOffer.toFixed(0)}
                    </strong>
                </div>

                <div>
                    <span>Asiye ${Math.round(
                        commissionRate *
                        100
                    )}%</span>
                    <strong>
                        R${this.money(
                            asiyeCommission
                        )}
                    </strong>
                </div>

                <div>
                    <span>You receive</span>
                    <strong>
                        R${this.money(
                            driverReceives
                        )}
                    </strong>
                </div>
            </div>

            <p class="driver-go-offer-status" role="status">${waiting
                ? `Counter R${this.money(request.driverCounterFare)} sent · waiting for the passenger`
                : lowOffer ? 'Low passenger offer · you decide whether to accept, decline or counter'
                    : 'Live passenger offer · accept, decline or counter'}</p>

            <div class="driver-go-recommendation">
                <span>Recommended counter</span>
                <strong>R${suggestedCounter.toFixed(0)}</strong>
                <p>You receive R${counterNet(suggestedCounter)} after commission.</p>
                <small>Based on the route fare. This is a recommendation; you can accept the passenger’s lower offer.</small>
            </div>

            <div class="driver-go-negotiation-copy">
                Accept the passenger offer, or counter between
                <strong>
                    R${passengerOffer.toFixed(0)}
                </strong>
                and
                <strong>
                    R${maximum.toFixed(0)}
                </strong>.
                Your passenger can accept your counter-offer before payment.
            </div>

            <div class="driver-go-counter-choices">
                <button type="button" data-counter-choice="${suggestedCounter}" ${canCounter ? '' : 'disabled'}>Use recommended R${suggestedCounter}</button>
                <button type="button" data-counter-choice="${maximum}" ${canCounter ? '' : 'disabled'}>Maximum R${maximum}</button>
            </div>

            <div class="driver-go-counter-row">
                <span>R</span>

                <input
                    id="driverCounterFareInput"
                    type="number"
                    inputmode="decimal"
                    min="${passengerOffer}"
                    max="${maximum}"
                    step="1"
                    value="${suggestedCounter}"
                    ${canCounter ? '' : 'disabled'}
                    aria-label="Driver counter fare"
                >

                <button
                    id="counterFareButton"
                    type="button"
                    class="driver-btn driver-btn-secondary"
                    ${!canCounter
                        ? 'disabled'
                        : ''}
                >
                    Make counter-offer
                </button>
            </div>

            <small>
                You receive <strong id="driverCounterNet">R${counterNet(suggestedCounter)}</strong> for this counter.
                The offer stays open until you or the passenger makes a decision.
                No payment is taken until the passenger agrees.
            </small>
        `;


        content.appendChild(
            panel
        );


        const acceptButton =
            document.getElementById(
                'acceptRequestButton'
            );


        if (acceptButton) {
            acceptButton.disabled = waiting;
            acceptButton.textContent =
                waiting ? 'Waiting for passenger' : `Accept R${passengerOffer.toFixed(0)}`;
        }

        const counterInput = panel.querySelector('#driverCounterFareInput');
        const updateNet = () => { panel.querySelector('#driverCounterNet').textContent = `R${counterNet(counterInput.value)}`; };
        counterInput.addEventListener('input', updateNet);
        panel.querySelectorAll('[data-counter-choice]').forEach(button => button.addEventListener('click', () => {
            counterInput.value = button.dataset.counterChoice;
            updateNet();
            counterInput.focus();
        }));


        const counterButton =
            document.getElementById(
                'counterFareButton'
            );


        counterButton
            ?.addEventListener(
                'click',
                async event => {

                    const button =
                        event.currentTarget;

                    const input =
                        document.getElementById(
                            'driverCounterFareInput'
                        );

                    const amount =
                        Math.round(
                            Number(
                                input?.value
                            )
                        );


                    if (
                        !Number.isFinite(
                            amount
                        ) ||
                        amount <
                            passengerOffer ||
                        amount >
                            maximum
                    ) {

                        ASIYE_DRIVER.ui
                            ?.toast?.(
                                `Counter between R${passengerOffer} and R${maximum}.`,
                                'danger'
                            );

                        return;
                    }


                    button.disabled =
                        true;

                    button.textContent =
                        'Sending...';


                    try {

                        await ASIYE_DRIVER.requests
                            .counterFare(
                                amount,
                                request.requestId ||
                                request.key
                            );


                        button.textContent = 'Counter sent';
                        counterInput.disabled = true;
                        panel.querySelectorAll('[data-counter-choice]').forEach(choice => { choice.disabled = true; });
                        panel.querySelector('[role="status"]').textContent = `Counter R${amount} sent · waiting for the passenger`;
                        if (acceptButton) {
                            acceptButton.disabled = true;
                            acceptButton.textContent = 'Waiting for passenger';
                        }


                    } catch (error) {

                        console.error(
                            'Counter fare failed:',
                            error
                        );


                        ASIYE_DRIVER.ui
                            ?.toast?.(
                                error.message ||
                                'Could not send counter offer.',
                                'danger'
                            );


                        button.disabled =
                            false;

                        button.textContent =
                            'Make counter-offer';
                    }
                }
            );
    }
};
