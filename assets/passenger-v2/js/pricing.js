/* ============================================================
   ASIYE PASSENGER V2
   PRICING SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.pricing = {

    /*
     * Market-reference model used as the anchor for both Asiye Go and Work.
     *
     * GO negotiation is deliberately bounded:
     *   suggested fare: 90% of market reference
     *   minimum offer: 85%
     *   maximum driver counter: 95%
     *   Asiye commission: 20%
     *   driver receives: 80%
     *
     * This means the minimum permitted Go fare still pays the driver
     * 68% of the market-reference value (85% × 80%) while Asiye keeps
     * its full 20% commission.
     */
    rates: {
        market: {
            baseFare: 12,
            perKm: 8.25,
            perMinute: 0.90,
            bookingFee: 5,
            minimumFare: 30
        },

        go: {
            suggestedRatio: 0.90,
            minimumRatio: 0.85,
            maximumRatio: 0.95,
            commissionRate: 0.20
        },

        clubMarkup: 0.15
    },


    money(value) {
        const number =
            Number(value || 0);

        return Math.round(
            number * 100
        ) / 100;
    },


    calculate() {

        const distanceKm =
            Number(
                ASIYE.state.route.distanceKm ||
                0
            );

        const durationMinutes =
            Number(
                ASIYE.state.route.durationMinutes ||
                0
            );

        const market =
            this.rates.market;

        const marketFare =
            Math.max(
                market.minimumFare,

                market.baseFare +
                (
                    distanceKm *
                    market.perKm
                ) +
                (
                    durationMinutes *
                    market.perMinute
                ) +
                market.bookingFee
            );

        const marketReferenceFare =
            Math.round(
                marketFare
            );

        const goRules =
            this.rates.go;

        const minimumOffer =
            Math.max(
                1,
                Math.ceil(
                    marketReferenceFare *
                    goRules.minimumRatio
                )
            );

        const maximumOffer =
            Math.max(
                minimumOffer,
                Math.floor(
                    marketReferenceFare *
                    goRules.maximumRatio
                )
            );

        const suggestedFare =
            Math.min(
                maximumOffer,
                Math.max(
                    minimumOffer,
                    Math.round(
                        marketReferenceFare *
                        goRules.suggestedRatio
                    )
                )
            );

        const driverMinimumNet =
            this.money(
                minimumOffer *
                (
                    1 -
                    goRules.commissionRate
                )
            );

        const driverSuggestedNet =
            this.money(
                suggestedFare *
                (
                    1 -
                    goRules.commissionRate
                )
            );

        const minimumAsiyeCommission =
            this.money(
                minimumOffer *
                goRules.commissionRate
            );

        /*
         * Asiye Work uses the market reference but splits the trip across
         * the actual pool target: 3 passengers for Work 3 and 4 passengers
         * for Work 4.
         */
        const club4Fare =
            Math.ceil(
                (
                    marketReferenceFare /
                    3
                ) *
                (
                    1 +
                    this.rates.clubMarkup
                )
            );

        const club7Fare =
            Math.ceil(
                (
                    marketReferenceFare /
                    4
                ) *
                (
                    1 +
                    this.rates.clubMarkup
                )
            );

        return {
            marketReference:
                marketReferenceFare,

            go:
                suggestedFare,

            goSuggested:
                suggestedFare,

            goMinimumOffer:
                minimumOffer,

            goMaximumOffer:
                maximumOffer,

            goCommissionRate:
                goRules.commissionRate,

            goDriverMinimumNet:
                driverMinimumNet,

            goDriverSuggestedNet:
                driverSuggestedNet,

            goMinimumAsiyeCommission:
                minimumAsiyeCommission,

            goSuggestedDiscountPercent:
                Math.round(
                    (
                        1 -
                        goRules.suggestedRatio
                    ) *
                    100
                ),

            goMaximumDiscountPercent:
                Math.round(
                    (
                        1 -
                        goRules.minimumRatio
                    ) *
                    100
                ),

            club4:
                club4Fare,

            club7:
                club7Fare,

            club4Total:
                club4Fare * 3,

            club7Total:
                club7Fare * 4,

            clubMarkupPercent:
                Math.round(
                    this.rates.clubMarkup *
                    100
                )
        };
    },


    clampGoOffer(
        amount,
        quote = null
    ) {

        const prices =
            quote ||
            this.calculate();

        const minimum =
            Number(
                prices.goMinimumOffer ||
                0
            );

        const maximum =
            Number(
                prices.goMaximumOffer ||
                minimum
            );

        const proposed =
            Number(amount);

        if (
            !Number.isFinite(
                proposed
            )
        ) {
            return Number(
                prices.goSuggested ||
                minimum
            );
        }

        return Math.min(
            maximum,
            Math.max(
                minimum,
                Math.round(
                    proposed
                )
            )
        );
    },


    goBreakdown(
        amount,
        quote = null
    ) {

        const prices =
            quote ||
            this.calculate();

        const fare =
            this.clampGoOffer(
                amount,
                prices
            );

        const commissionRate =
            Number(
                prices.goCommissionRate ||
                this.rates.go
                    .commissionRate
            );

        const asiyeCommission =
            this.money(
                fare *
                commissionRate
            );

        const driverReceives =
            this.money(
                fare -
                asiyeCommission
            );

        return {
            fare,
            asiyeCommission,
            driverReceives,
            commissionRate
        };
    }
};
