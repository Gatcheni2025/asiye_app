/* ============================================================
   ASIYE PASSENGER V2
   PRICING SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.pricing = {

    /*
     * Temporary clean V2 pricing.
     * We can replace these with your exact
     * production values later.
     */

    rates: {

        go: {

            baseFare:
                20,

            perKm:
                9,

            minimumFare:
                25
        },


        club4: {

            divisor:
                4,

            minimumFare:
                18
        },


        club7: {

            divisor:
                7,

            minimumFare:
                15
        }

    },


    calculate() {

        const distanceKm =
            Number(
                ASIYE.state.route.distanceKm || 0
            );


        const goConfig =
            this.rates.go;


        let goFare =

            goConfig.baseFare +

            (
                distanceKm *
                goConfig.perKm
            );


        goFare = Math.max(

            goConfig.minimumFare,

            goFare
        );


        goFare =
            Math.round(
                goFare
            );


        /*
         * Club pricing:
         *
         * One total route fare,
         * split across every paying passenger.
         */

        const club4Fare =

            Math.ceil(
                goFare / 4
            );


        const club7Fare =

            Math.ceil(
                goFare / 7
            );


        return {

            go:
                goFare,

            club4:
                club4Fare,

            club7:
                club7Fare,

            club4Total:
                goFare,

            club7Total:
                goFare
        };
    }

};