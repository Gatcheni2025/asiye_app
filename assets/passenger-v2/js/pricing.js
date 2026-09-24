/* ============================================================
   ASIYE PASSENGER V2
   PRICING SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.pricing = {

    /*
     * Market-parity estimate for the standard ride.
     * This is the single fare source used by both passenger and driver.
     * It models a typical Uber/Bolt economy quote from route distance/time.
     */
    rates: {
        market: {
            baseFare: 12,
            perKm: 8.25,
            perMinute: 0.90,
            bookingFee: 5,
            minimumFare: 30
        },
        goDiscount: 0.15,
        clubMarkup: 0.15
    },


    calculate() {

        const distanceKm =
            Number(
                ASIYE.state.route.distanceKm || 0
            );


        const durationMinutes = Number(ASIYE.state.route.durationMinutes || 0);
        const market = this.rates.market;

        const marketFare = Math.max(
            market.minimumFare,
            market.baseFare +
            (distanceKm * market.perKm) +
            (durationMinutes * market.perMinute) +
            market.bookingFee
        );

        // Asiye Go is intentionally 15% below the internal Uber/Bolt
        // market-reference estimate. Club remains based on the undiscouted
        // market reference, split by seats and then marked up 15%.
        const marketReferenceFare = Math.round(marketFare);
        const goFare = Math.max(
            1,
            Math.round(marketReferenceFare * (1 - this.rates.goDiscount))
        );
        const club4Fare = Math.ceil((marketReferenceFare / 4) * (1 + this.rates.clubMarkup));
        const club7Fare = Math.ceil((marketReferenceFare / 7) * (1 + this.rates.clubMarkup));

        return {
            marketReference: marketReferenceFare,
            go: goFare,
            club4: club4Fare,
            club7: club7Fare,
            club4Total: club4Fare * 4,
            club7Total: club7Fare * 7,
            goDiscountPercent: 15,
            clubMarkupPercent: 15
        };
    }

};