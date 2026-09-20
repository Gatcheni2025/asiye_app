/* ============================================================
   ASIYE PASSENGER V2
   Configuration
   ============================================================ */

window.ASIYE_CONFIG = {

    /*
     * Paste your EXISTING Mapbox public token here.
     *
     * Do not put Firebase Admin keys,
     * service account keys or private server secrets here.
     */

    mapboxToken:
        'pk.eyJ1IjoiYXNpeWUxIiwiYSI6ImNtcWR2dHBydDEyMjIycXF5eThzcWUzcXUifQ.KgsJuS9O1OLDvAN2CMmrKw',


    appName:
        'Asiye',


    currency:
        'ZAR',


    /*
     * FNB PayShap Request-to-Pay
     *
     * Mobile Flutter/WebView builds must point apiBase at the
     * public HTTPS Asiye payment backend. FNB credentials and
     * bank API URLs must NEVER be placed in this client config.
     *
     * Example:
     * apiBase: 'https://payments.example.com'
     */
    payshap: {

        apiBase:
            '',

        createRequestPath:
            '/api/wallet/payshap/requests',

        requestStatusPath:
            '/api/wallet/payshap/requests',

        pollIntervalMs:
            3000
    }

};