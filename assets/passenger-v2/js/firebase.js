/* ============================================================
   ASIYE PASSENGER V2
   FIREBASE INITIALIZATION
   ============================================================ */

window.ASIYE =
    window.ASIYE || {};


/* ============================================================
   FIREBASE CONFIG
   ============================================================ */

const firebaseConfig = {

    apiKey:
        "AIzaSyCX_euO2EEPhfhuG5DTsSi5vCpZ9MFZczY",

    authDomain:
        "asiye-80386.firebaseapp.com",

    databaseURL:
        "https://asiye-80386-default-rtdb.firebaseio.com",

    projectId:
        "asiye-80386",

    storageBucket:
        "asiye-80386.firebasestorage.app",

    messagingSenderId:
        "531902350858",

    appId:
        "1:531902350858:web:f8a4a246bf350d50e3c1f3"
};


/* ============================================================
   INITIALIZE FIREBASE
   ============================================================ */

try {

    if (
        typeof firebase ===
        "undefined"
    ) {

        throw new Error(
            "Firebase SDK has not loaded."
        );
    }


    /*
     * Prevent duplicate initialization.
     */

    if (
        firebase.apps &&
        firebase.apps.length > 0
    ) {

        ASIYE.firebaseApp =
            firebase.app();


        console.log(
            "✅ Existing Firebase app reused"
        );

    } else {

        ASIYE.firebaseApp =

            firebase.initializeApp(
                firebaseConfig
            );


        console.log(
            "✅ Passenger Firebase initialized"
        );
    }


    /* ========================================================
       SERVICES
       ======================================================== */

    ASIYE.auth =
        firebase.auth();


    ASIYE.database =
        firebase.database();


    /*
     * Storage is optional.
     * Only initialize if firebase-storage-compat.js is loaded.
     */

    if (
        typeof firebase.storage ===
        "function"
    ) {

        ASIYE.storage =
            firebase.storage();

    } else {

        ASIYE.storage =
            null;


        console.warn(
            "⚠️ Firebase Storage SDK not loaded"
        );
    }


    /*
     * Compatibility for older Asiye code.
     */

    window.database =
        ASIYE.database;


    console.log(
        "✅ Passenger Firebase Database ready"
    );


    console.log(
        "Firebase project:",
        firebase.app().options.projectId
    );


} catch (error) {

    console.error(
        "❌ Passenger Firebase initialization failed:",
        error
    );


    window.ASIYE_FIREBASE_ERROR =
        error;
}